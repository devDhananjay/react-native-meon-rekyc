import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import {
  openSettings,
  PERMISSIONS,
  request,
  requestMultiple,
  RESULTS,
} from 'react-native-permissions';
import { initializeReKycSession } from './src/api';

export { companyLogin, getDeepLink, initializeReKycSession } from './src/api';

const REQUIRED_FIELDS = [
  { key: 'username', label: 'username' },
  { key: 'password', label: 'password' },
  { key: 'company_id', label: 'company_id' },
  { key: 'workflow_id', label: 'workflow_id' },
  { key: 'client_code', label: 'client_code' },
];

const MeonReKYC = ({
  username,
  password,
  company_id,
  workflow_id,
  client_code,
  baseURL = 'https://rekyc.meon.co.in',
  onSuccess,
  onError,
  onClose,
  showHeader = true,
  headerTitle = 'Re-KYC',
  customStyles = {},
  autoRequestPermissions = true,
}) => {
  const [isInitializing, setIsInitializing] = useState(true);
  const [webViewLoading, setWebViewLoading] = useState(false);
  const [deeplink, setDeeplink] = useState(null);
  const [error, setError] = useState(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [isIpvStep, setIsIpvStep] = useState(false);

  const webViewRef = useRef(null);
  const sessionStartedRef = useRef(false);
  const ipvPermissionRequestedRef = useRef(false);

  const checkIfIpvStep = (url) =>
    !!url &&
    (url.includes('face-finder.meon.co.in') ||
      url.toLowerCase().includes('/ipv') ||
      url.toLowerCase().includes('face') ||
      url.toLowerCase().includes('video') ||
      url.toLowerCase().includes('recording'));

  const validateProps = useCallback(() => {
    const values = { username, password, company_id, workflow_id, client_code };
    const missing = REQUIRED_FIELDS.filter(({ key }) => {
      const value = values[key];
      return value === undefined || value === null || String(value).trim() === '';
    });

    if (missing.length > 0) {
      const message = `Missing required field(s): ${missing.map((item) => item.label).join(', ')}`;
      setError(message);
      onError?.(message);
      return false;
    }

    return true;
  }, [username, password, company_id, workflow_id, client_code, onError]);

  const requestPermissions = useCallback(async () => {
    if (!autoRequestPermissions) {
      setPermissionsGranted(true);
      return true;
    }

    try {
      if (Platform.OS === 'android') {
        const results = await requestMultiple([
          PERMISSIONS.ANDROID.CAMERA,
          PERMISSIONS.ANDROID.RECORD_AUDIO,
          PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
        ]);

        const cameraGranted =
          results[PERMISSIONS.ANDROID.CAMERA] === RESULTS.GRANTED;
        const micGranted =
          results[PERMISSIONS.ANDROID.RECORD_AUDIO] === RESULTS.GRANTED;
        const granted = cameraGranted && micGranted;
        setPermissionsGranted(granted);
        if (!granted) {
          Alert.alert(
            'Permissions Required',
            'Camera and microphone access are required for video verification.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => openSettings() },
              { text: 'Retry', onPress: () => requestPermissions() },
            ],
          );
        }
        return granted;
      }

      const cameraResult = await request(PERMISSIONS.IOS.CAMERA);
      const microphoneResult = await request(PERMISSIONS.IOS.MICROPHONE);
      await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);

      const granted =
        cameraResult === RESULTS.GRANTED &&
        microphoneResult === RESULTS.GRANTED;

      setPermissionsGranted(granted);
      if (!granted) {
        Alert.alert(
          'Permissions Required',
          'Camera and microphone access are required for video verification.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => openSettings() },
            { text: 'Retry', onPress: () => requestPermissions() },
          ],
        );
      }
      return granted;
    } catch (permissionError) {
      console.error('[MeonReKYC] Permission error:', permissionError);
      return false;
    }
  }, [autoRequestPermissions]);

  const startSession = useCallback(async () => {
    if (sessionStartedRef.current) {
      return;
    }
    sessionStartedRef.current = true;

    if (!validateProps()) {
      setIsInitializing(false);
      return;
    }

    setIsInitializing(true);
    setError(null);

    try {
      if (autoRequestPermissions) {
        await requestPermissions();
      } else {
        setPermissionsGranted(true);
      }

      console.log('[MeonReKYC] Starting company login...');
      const session = await initializeReKycSession({
        username: String(username).trim(),
        password: String(password),
        companyId: String(company_id).trim(),
        workflowId: String(workflow_id).trim(),
        clientCode: String(client_code).trim(),
        baseURL,
      });

      console.log('[MeonReKYC] Deeplink received:', session.deeplink);
      setDeeplink(session.deeplink);
      onSuccess?.({
        status: 'session_ready',
        deeplink: session.deeplink,
        companyUsername: session.companyUsername,
        timestamp: new Date().toISOString(),
      });
    } catch (sessionError) {
      const message =
        sessionError?.message || 'Failed to initialize Re-KYC session';
      console.error('[MeonReKYC] Session error:', message);
      setError(message);
      onError?.(message);
      sessionStartedRef.current = false;
    } finally {
      setIsInitializing(false);
    }
  }, [
    autoRequestPermissions,
    baseURL,
    client_code,
    company_id,
    onError,
    onSuccess,
    password,
    requestPermissions,
    username,
    validateProps,
    workflow_id,
  ]);

  useEffect(() => {
    startSession();
  }, [startSession]);

  useEffect(() => {
    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onBackPress,
    );
    return () => subscription.remove();
  }, [canGoBack]);

  const handleClose = () => {
    Alert.alert('Close Re-KYC', 'Are you sure you want to close?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close', onPress: () => onClose?.() },
    ]);
  };

  const handleRetry = () => {
    sessionStartedRef.current = false;
    setDeeplink(null);
    startSession();
  };

  const handleRefresh = () => {
    if (webViewRef.current && deeplink) {
      ipvPermissionRequestedRef.current = false;
      setIsIpvStep(false);
      webViewRef.current.reload();
      return;
    }
    handleRetry();
  };

  const injectPermissionScripts = useCallback(() => {
    const script = `
      (function() {
        const granted = ${permissionsGranted};
        const permissions = ['camera', 'microphone', 'geolocation'];
        const storePermission = (name, state) => {
          try {
            sessionStorage.setItem('permission_' + name, state);
            localStorage.setItem('permission_' + name, state);
          } catch (e) {}
        };
        permissions.forEach((name) => {
          storePermission(name, granted ? 'granted' : 'denied');
        });
        if (navigator.permissions && navigator.permissions.query) {
          const originalQuery = navigator.permissions.query;
          navigator.permissions.query = function(desc) {
            if (permissions.includes(desc.name)) {
              return Promise.resolve({ state: granted ? 'granted' : 'denied', onchange: null });
            }
            return originalQuery.call(this, desc);
          };
        }
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = function(constraints) {
            if (!granted) {
              return Promise.reject(new Error('Permissions not granted'));
            }
            return originalGetUserMedia(constraints);
          };
        }
      })();
      true;
    `;
    webViewRef.current?.injectJavaScript(script);
  }, [permissionsGranted]);

  const handleWebViewNavigationStateChange = useCallback(
    async (navState) => {
      setCanGoBack(navState.canGoBack);
      const isCurrentlyIpv = checkIfIpvStep(navState.url);

      if (
        isCurrentlyIpv &&
        !ipvPermissionRequestedRef.current &&
        !navState.loading &&
        autoRequestPermissions
      ) {
        ipvPermissionRequestedRef.current = true;
        setIsIpvStep(true);
        const granted = await requestPermissions();
        if (granted) {
          webViewRef.current?.reload();
        }
      } else if (!isCurrentlyIpv && isIpvStep) {
        setIsIpvStep(false);
        ipvPermissionRequestedRef.current = false;
      }
    },
    [autoRequestPermissions, isIpvStep, requestPermissions],
  );

  const renderHeader = () => {
    if (!showHeader) {
      return null;
    }

    return (
      <View style={[styles.headerContainer, customStyles.header]}>
        <StatusBar barStyle="dark-content" backgroundColor="#fff" />
        <TouchableOpacity
          style={styles.headerButton}
          onPress={
            canGoBack
              ? () => webViewRef.current?.goBack()
              : handleClose
          }
        >
          <Text style={styles.headerButtonText}>{canGoBack ? '←' : '✕'}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, customStyles.headerTitle]}>
          {isIpvStep ? 'Video Verification' : headerTitle}
        </Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={handleRefresh}
          accessibilityLabel="Refresh"
        >
          <Text style={styles.headerButtonText}>↻</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (isInitializing) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#0047AB" />
        <Text style={styles.loadingText}>Initializing Re-KYC...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
        {autoRequestPermissions && !permissionsGranted ? (
          <TouchableOpacity
            style={[styles.retryButton, styles.settingsButton]}
            onPress={() => openSettings()}
          >
            <Text style={styles.retryText}>Open Settings</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (!deeplink) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Error</Text>
        <Text style={styles.errorMessage}>Deeplink not available</Text>
        <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, customStyles.container]}>
      {renderHeader()}
      <View style={styles.webViewContainer}>
        {webViewLoading ? (
          <View style={styles.webViewLoader}>
            <ActivityIndicator size="small" color="#0047AB" />
          </View>
        ) : null}
        <WebView
          ref={webViewRef}
          source={{ uri: deeplink }}
          style={styles.webView}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          allowsProtectedMedia
          geolocationEnabled
          mediaCapturePermissionGrantType="grant"
          onNavigationStateChange={handleWebViewNavigationStateChange}
          onLoadStart={() => setWebViewLoading(true)}
          onLoadEnd={() => {
            setWebViewLoading(false);
            injectPermissionScripts();
          }}
          onError={(event) => {
            const message =
              event?.nativeEvent?.description || 'Failed to load Re-KYC page';
            setError(message);
            onError?.(message);
            setWebViewLoading(false);
          }}
          originWhitelist={['*']}
          mixedContentMode="compatibility"
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          cacheEnabled
          userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Mobile Safari/537.36"
          injectedJavaScriptBeforeContentLoaded={`
            window.permissionsGranted = ${permissionsGranted};
            true;
          `}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    elevation: 2,
  },
  headerButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    minWidth: 36,
    alignItems: 'center',
  },
  headerButtonText: {
    fontSize: 20,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  webViewContainer: {
    flex: 1,
    position: 'relative',
  },
  webView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webViewLoader: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1000,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 15,
    padding: 8,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 30,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  errorMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#0047AB',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  settingsButton: {
    backgroundColor: '#555',
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default MeonReKYC;

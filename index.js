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

const checkIfIpvStep = (url) =>
  !!url &&
  (url.includes('face-finder.meon.co.in') ||
    url.toLowerCase().includes('/ipv') ||
    url.toLowerCase().includes('/ipv/'));

const getDefaultUserAgent = () => {
  if (Platform.OS === 'ios') {
    return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  }
  return 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
};

// iOS crashes if WKWebView native alert/confirm handlers are invoked without completionHandler.
// Re-KYC pages call alert() on date-picker flows — override before page scripts run.
const DIALOG_OVERRIDE_BEFORE_CONTENT = `
(function() {
  if (window.__meonRekycDialogPatched) { return; }
  window.__meonRekycDialogPatched = true;
  const postDialog = function(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (e) {}
  };
  window.alert = function(message) {
    postDialog({ bridge: 'dialog', type: 'alert', message: message == null ? '' : String(message) });
  };
  window.confirm = function(message) {
    postDialog({ bridge: 'dialog', type: 'confirm', message: message == null ? '' : String(message) });
    return true;
  };
  window.prompt = function(message, defaultValue) {
    postDialog({
      bridge: 'dialog',
      type: 'prompt',
      message: message == null ? '' : String(message),
      defaultValue: defaultValue == null ? '' : String(defaultValue),
    });
    return defaultValue == null ? '' : String(defaultValue);
  };
})();
true;
`;

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
  showRefreshButton = true,
  customStyles = {},
  autoRequestPermissions = true,
  userAgent,
  enableWebViewDebug = __DEV__,
  onWebMessage,
}) => {
  const resolvedUserAgent = userAgent || getDefaultUserAgent();
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

  const requestPermissions = useCallback(async ({ showAlert = true } = {}) => {
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

        const granted =
          results[PERMISSIONS.ANDROID.CAMERA] === RESULTS.GRANTED &&
          results[PERMISSIONS.ANDROID.RECORD_AUDIO] === RESULTS.GRANTED;

        setPermissionsGranted(granted);

        if (!granted && showAlert) {
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

      if (!granted && showAlert) {
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

  const buildWebViewBootstrapScript = useCallback(
    (granted) => `
    (function() {
      const granted = ${granted};
      const permissions = ['camera', 'microphone', 'geolocation'];
      const storePermission = (name, state) => {
        try {
          sessionStorage.setItem('permission_' + name, state);
          localStorage.setItem('permission_' + name, state);
        } catch (e) {}
      };
      permissions.forEach((name) => {
        storePermission(name, granted ? 'granted' : 'prompt');
      });
      window.permissionsGranted = granted;
      if (navigator.permissions && navigator.permissions.query) {
        const originalQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = function(desc) {
          if (permissions.includes(desc.name)) {
            return Promise.resolve({ state: granted ? 'granted' : 'prompt', onchange: null });
          }
          return originalQuery(desc);
        };
      }
      if (!window.__meonRekycDialogPatched) {
        window.__meonRekycDialogPatched = true;
        const postDialog = function(payload) {
          try {
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
              window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }
          } catch (e) {}
        };
        window.alert = function(message) {
          postDialog({ bridge: 'dialog', type: 'alert', message: message == null ? '' : String(message) });
        };
        window.confirm = function(message) {
          postDialog({ bridge: 'dialog', type: 'confirm', message: message == null ? '' : String(message) });
          return true;
        };
        window.prompt = function(message, defaultValue) {
          postDialog({
            bridge: 'dialog',
            type: 'prompt',
            message: message == null ? '' : String(message),
            defaultValue: defaultValue == null ? '' : String(defaultValue),
          });
          return defaultValue == null ? '' : String(defaultValue);
        };
      }
      ${enableWebViewDebug ? `
      if (!window.__meonRekycBridgeInstalled && window.ReactNativeWebView) {
        window.__meonRekycBridgeInstalled = true;
        const postBridge = (payload) => {
          try {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          } catch (e) {}
        };
        const levels = ['log', 'warn', 'error'];
        levels.forEach((level) => {
          const original = console[level];
          console[level] = function() {
            try {
              const message = Array.prototype.slice.call(arguments).map((arg) => {
                try { return typeof arg === 'object' ? JSON.stringify(arg) : String(arg); }
                catch (e) { return String(arg); }
              }).join(' ');
              postBridge({ bridge: 'console', level, message });
            } catch (e) {}
            return original.apply(console, arguments);
          };
        });
        window.addEventListener('error', function(event) {
          postBridge({
            bridge: 'error',
            message: event && event.message ? String(event.message) : 'Unknown error',
            source: event && event.filename ? String(event.filename) : '',
            line: event && event.lineno ? event.lineno : 0,
            col: event && event.colno ? event.colno : 0,
          });
        });
        window.addEventListener('unhandledrejection', function(event) {
          postBridge({
            bridge: 'unhandledrejection',
            message: event && event.reason ? String(event.reason) : 'Unhandled rejection',
          });
        });
      }
      ` : ''}
    })();
    true;
  `,
    [enableWebViewDebug],
  );

  const injectPermissionScripts = useCallback(
    (grantedOverride) => {
      const granted =
        typeof grantedOverride === 'boolean' ? grantedOverride : permissionsGranted;
      webViewRef.current?.injectJavaScript(buildWebViewBootstrapScript(granted));
    },
    [buildWebViewBootstrapScript, permissionsGranted],
  );

  const handleWebViewMessage = useCallback(
    (event) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data);
        if (!payload?.bridge) {
          return;
        }

        if (payload.bridge === 'dialog') {
          const dialogMessage = String(payload.message || '');
          if (payload.type === 'alert' && dialogMessage) {
            Alert.alert('Re-KYC', dialogMessage);
          }
          onWebMessage?.(payload);
          return;
        }

        if (enableWebViewDebug) {
          console.log('[MeonReKYC WebView]', payload);
        }

        onWebMessage?.(payload);

        const message = String(payload.message || '');
        const isFatalBridge =
          payload.bridge === 'error' ||
          payload.bridge === 'unhandledrejection' ||
          (payload.bridge === 'console' && payload.level === 'error');

        if (isFatalBridge && /invalid date/i.test(message)) {
          onError?.(message);
        }
      } catch (parseError) {
        if (enableWebViewDebug) {
          console.warn('[MeonReKYC] Failed to parse WebView message', parseError);
        }
      }
    },
    [enableWebViewDebug, onError, onWebMessage],
  );

  useEffect(() => {
    if (deeplink && permissionsGranted) {
      injectPermissionScripts();
    }
  }, [deeplink, permissionsGranted, injectPermissionScripts]);

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
        await requestPermissions({ showAlert: false });
      } else {
        setPermissionsGranted(true);
      }

      const session = await initializeReKycSession({
        username: String(username).trim(),
        password: String(password),
        companyId: String(company_id).trim(),
        workflowId: String(workflow_id).trim(),
        clientCode: String(client_code).trim(),
        baseURL,
      });

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

  const handleWebViewNavigationStateChange = useCallback(
    async (navState) => {
      setCanGoBack(navState.canGoBack);

      const onIpv = checkIfIpvStep(navState.url);
      setIsIpvStep(onIpv);

      if (onIpv && !navState.loading) {
        if (
          !ipvPermissionRequestedRef.current &&
          autoRequestPermissions &&
          !permissionsGranted
        ) {
          ipvPermissionRequestedRef.current = true;
          const granted = await requestPermissions({ showAlert: true });
          injectPermissionScripts(granted);
          if (granted) {
            webViewRef.current?.reload();
          }
        } else {
          injectPermissionScripts(permissionsGranted);
        }
      } else if (!onIpv) {
        ipvPermissionRequestedRef.current = false;
      }
    },
    [
      autoRequestPermissions,
      injectPermissionScripts,
      permissionsGranted,
      requestPermissions,
    ],
  );

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
    if (!webViewRef.current) {
      return;
    }
    setWebViewLoading(true);
    webViewRef.current.reload();
  };

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
        <View style={styles.headerRight}>
          {showRefreshButton ? (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleRefresh}
              accessibilityLabel="Refresh page"
              accessibilityRole="button"
            >
              <Text style={styles.headerButtonText}>⟳</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.headerButton} onPress={handleClose}>
            <Text style={styles.headerButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
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
          setSupportMultipleWindows={false}
          allowsLinkPreview={false}
          userAgent={resolvedUserAgent}
          injectedJavaScriptBeforeContentLoaded={DIALOG_OVERRIDE_BEFORE_CONTENT}
          onMessage={handleWebViewMessage}
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
    fontSize: 24,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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

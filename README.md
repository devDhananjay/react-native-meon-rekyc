# react-native-meon-rekyc

Re-KYC SDK for React Native. It logs in with company credentials, generates a deeplink, and opens the Re-KYC journey inside a WebView.

## Installation

```bash
npm install react-native-meon-rekyc react-native-webview react-native-permissions
```

### iOS

```bash
cd ios && pod install
```

Add permissions in `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera permission is required for Re-KYC verification</string>
<key>NSMicrophoneUsageDescription</key>
<string>Microphone permission is required for Re-KYC verification</string>
<key>NSLocationWhenInUseUsageDescription</key>
<string>Location permission is required for Re-KYC verification</string>
```

### Android

Add permissions in `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
```

## Usage

```javascript
import React from 'react';
import { View } from 'react-native';
import MeonReKYC from 'react-native-meon-rekyc';

const ReKycScreen = () => {
  return (
    <View style={{ flex: 1 }}>
      <MeonReKYC
        username="" //dhananjay@meon.co.in
        password="" //123456
        company_id="" //1
        workflow_id="" //7cd3b329-7b79-46c4-b4f3
        client_code="" //meon1
        baseURL="https://rekyc.meon.co.in"
        onSuccess={(data) => console.log('Re-KYC ready:', data)}
        onError={(error) => console.log('Re-KYC error:', error)}
        onClose={() => console.log('Re-KYC closed')}
      />
    </View>
  );
};

export default ReKycScreen;
```

## API Flow

1. `POST /v1/company/company-login` with `username`, `password`, `company_id`
2. `GET /v1/company/get_deep_link/{workflow_id}/{client_code}` with `Authorization: Bearer <access_token>`
3. Open `data.deeplink` in WebView

## Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `username` | `string` | Yes | - | Company login username |
| `password` | `string` | Yes | - | Company login password |
| `company_id` | `string` | Yes | - | Company ID |
| `workflow_id` | `string` | Yes | - | Workflow ID |
| `client_code` | `string` | Yes | - | Client code |
| `baseURL` | `string` | No | `https://rekyc.meon.co.in` | Re-KYC API base URL |
| `onSuccess` | `function` | No | - | Called when deeplink is ready |
| `onError` | `function` | No | - | Called on API or WebView error |
| `onClose` | `function` | No | - | Called when user closes |
| `showHeader` | `boolean` | No | `true` | Show header bar |
| `headerTitle` | `string` | No | `Re-KYC` | Header title |
| `autoRequestPermissions` | `boolean` | No | `true` | Request camera/mic/location |
| `customStyles` | `object` | No | `{}` | Style overrides |

## Exported Helpers

```javascript
import { companyLogin, getDeepLink, initializeReKycSession } from 'react-native-meon-rekyc';
```

## License

MIT

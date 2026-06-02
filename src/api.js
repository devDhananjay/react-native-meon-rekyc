const DEFAULT_BASE_URL = 'https://rekyc.meon.co.in';

const logApi = (label, payload) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[MeonReKYC API] ${label}`, payload);
  }
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || `Request failed with status ${response.status}`);
  }
};

const getApiMessage = (data, fallback = 'Request failed') =>
  data?.msg ||
  data?.message ||
  data?.error ||
  data?.data?.msg ||
  data?.data?.message ||
  fallback;

const extractDeeplink = (data) =>
  data?.data?.deeplink ||
  data?.data?.deep_link ||
  data?.deeplink ||
  data?.deep_link ||
  null;

const isApiSuccess = (data, response) =>
  response.ok &&
  (data?.success === true ||
    data?.success === 'true' ||
    String(data?.status || '').toLowerCase() === 'success');

export const companyLogin = async ({
  username,
  password,
  companyId,
  baseURL = DEFAULT_BASE_URL,
}) => {
  const loginUrl = `${baseURL}/v1/company/company-login`;
  logApi('REQUEST', {
    method: 'POST',
    url: loginUrl,
    body: { username, company_id: String(companyId), password: '***' },
  });

  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      password,
      company_id: String(companyId),
    }),
  });

  const data = await parseJsonResponse(response);

  logApi('RESPONSE company-login', {
    status: response.status,
    ok: response.ok,
    success: data?.success,
    msg: data?.msg,
    data: data?.data,
    full: data,
  });

  if (!isApiSuccess(data, response)) {
    throw new Error(getApiMessage(data, 'Company login failed'));
  }

  const accessToken = data?.data?.access_token;
  if (!accessToken) {
    throw new Error(getApiMessage(data, 'Access token not found in login response'));
  }

  return {
    accessToken,
    refreshToken: data?.data?.refresh_token,
    companyUsername: data?.data?.company_username,
    raw: data,
  };
};

export const getDeepLink = async ({
  workflowId,
  clientCode,
  accessToken,
  baseURL = DEFAULT_BASE_URL,
}) => {
  const encodedWorkflowId = encodeURIComponent(String(workflowId));
  const encodedClientCode = encodeURIComponent(String(clientCode));
  const url = `${baseURL}/v1/company/get_deep_link/${encodedWorkflowId}/${encodedClientCode}`;

  logApi('REQUEST', {
    method: 'GET',
    url,
    workflowId,
    clientCode,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await parseJsonResponse(response);

  const deeplink = extractDeeplink(data);

  logApi('RESPONSE get_deep_link', {
    status: response.status,
    ok: response.ok,
    success: data?.success,
    msg: data?.msg,
    deeplink,
    data: data?.data,
    full: data,
  });

  if (!isApiSuccess(data, response)) {
    throw new Error(getApiMessage(data, 'Failed to generate deeplink'));
  }

  if (!deeplink) {
    throw new Error(getApiMessage(data, 'Deeplink URL not found in response'));
  }

  return {
    deeplink,
    raw: data,
  };
};

export const initializeReKycSession = async (params) => {
  logApi('initializeReKycSession start', {
    baseURL: params.baseURL || DEFAULT_BASE_URL,
    workflowId: params.workflowId,
    clientCode: params.clientCode,
    companyId: params.companyId,
    username: params.username,
  });

  const loginResult = await companyLogin(params);
  const deeplinkResult = await getDeepLink({
    workflowId: params.workflowId,
    clientCode: params.clientCode,
    accessToken: loginResult.accessToken,
    baseURL: params.baseURL,
  });

  const session = {
    ...loginResult,
    ...deeplinkResult,
  };

  logApi('initializeReKycSession done', {
    deeplink: session.deeplink,
    companyUsername: session.companyUsername,
  });

  return session;
};

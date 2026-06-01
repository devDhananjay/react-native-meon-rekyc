const DEFAULT_BASE_URL = 'https://rekyc.meon.co.in';

const parseJsonResponse = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text || `Request failed with status ${response.status}`);
  }
};

export const companyLogin = async ({
  username,
  password,
  companyId,
  baseURL = DEFAULT_BASE_URL,
}) => {
  const response = await fetch(`${baseURL}/v1/company/company-login`, {
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

  if (!response.ok || !data?.success) {
    throw new Error(data?.msg || 'Company login failed');
  }

  const accessToken = data?.data?.access_token;
  if (!accessToken) {
    throw new Error('Access token not found in login response');
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

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || !data?.success) {
    throw new Error(data?.msg || 'Failed to generate deeplink');
  }

  const deeplink = data?.data?.deeplink;
  if (!deeplink) {
    throw new Error('Deeplink URL not found in response');
  }

  return {
    deeplink,
    raw: data,
  };
};

export const initializeReKycSession = async (params) => {
  const loginResult = await companyLogin(params);
  const deeplinkResult = await getDeepLink({
    workflowId: params.workflowId,
    clientCode: params.clientCode,
    accessToken: loginResult.accessToken,
    baseURL: params.baseURL,
  });

  return {
    ...loginResult,
    ...deeplinkResult,
  };
};

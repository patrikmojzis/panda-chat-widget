export type CurrentUser = {
  id: string;
  email: string;
};

export type CurrentWorkspace = {
  id: string;
  name: string;
};

export type AuthContext = {
  user: CurrentUser;
  workspace: CurrentWorkspace;
};

export type AuthResponseBody = AuthContext;

export type SetupRequest = {
  email: string;
  password: string;
  workspaceName: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type InvalidSetupReason =
  | 'invalid_email'
  | 'invalid_password'
  | 'invalid_workspace_name';

export type InvalidLoginReason = 'invalid_email' | 'invalid_password';

export type SetupParseResult =
  | {
      status: 'valid';
      request: SetupRequest;
    }
  | {
      status: 'invalid';
      reason: InvalidSetupReason;
    };

export type LoginParseResult =
  | {
      status: 'valid';
      request: LoginRequest;
    }
  | {
      status: 'invalid';
      reason: InvalidLoginReason;
    };

const EMAIL_MAX_LENGTH = 254;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const WORKSPACE_NAME_MAX_LENGTH = 100;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthRequestValues = Partial<Record<keyof SetupRequest, unknown>>;

export function parseSetupRequest(body: unknown): SetupParseResult {
  const values = readRequestValues(body);

  if (!values) {
    return { status: 'invalid', reason: 'invalid_email' };
  }

  const email = normalizeEmail(values.email);

  if (!email) {
    return { status: 'invalid', reason: 'invalid_email' };
  }

  const password = normalizePassword(values.password);

  if (!password) {
    return { status: 'invalid', reason: 'invalid_password' };
  }

  const workspaceName = normalizeWorkspaceName(values.workspaceName);

  if (!workspaceName) {
    return { status: 'invalid', reason: 'invalid_workspace_name' };
  }

  return { status: 'valid', request: { email, password, workspaceName } };
}

export function parseLoginRequest(body: unknown): LoginParseResult {
  const values = readRequestValues(body);

  if (!values) {
    return { status: 'invalid', reason: 'invalid_email' };
  }

  const email = normalizeEmail(values.email);

  if (!email) {
    return { status: 'invalid', reason: 'invalid_email' };
  }

  const password = normalizePassword(values.password);

  if (!password) {
    return { status: 'invalid', reason: 'invalid_password' };
  }

  return { status: 'valid', request: { email, password } };
}

function readRequestValues(body: unknown): AuthRequestValues | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  return body as AuthRequestValues;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();

  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return email;
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    return null;
  }

  return value;
}

function normalizeWorkspaceName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const workspaceName = value.trim();

  if (workspaceName.length === 0 || workspaceName.length > WORKSPACE_NAME_MAX_LENGTH) {
    return null;
  }

  return workspaceName;
}

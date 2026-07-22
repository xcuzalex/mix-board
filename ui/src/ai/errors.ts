/**
 * Structured AI error classification.
 *
 * Every error carries a `category` so the UI can show targeted recovery
 * hints instead of generic "something went wrong" messages.
 */

export type AIErrorCategory =
  | 'auth'           // credentials missing, invalid, or expired
  | 'rate_limit'     // provider rate-limited the request
  | 'quota'          // billing / usage quota exceeded
  | 'network'        // connection timeout, DNS failure, etc.
  | 'invalid_output' // AI returned non-JSON or schema-invalid output
  | 'ref_missing'    // operation references an element that doesn't exist
  | 'capability'     // requested operation beyond current capability set
  | 'provider'       // generic provider-side error (500, model not found, etc.)
  | 'execute'        // execution engine error (element creation failed, etc.)
  | 'context'        // failed to build board context / snapshot
  | 'unknown';       // catch-all

export type AIErrorStage =
  | 'context'
  | 'prompt'
  | 'provider'
  | 'parse'
  | 'execute';

export interface AIError {
  category: AIErrorCategory;
  stage: AIErrorStage;
  message: string;
  details?: string;
  recovery?: string;       // user-facing recovery hint (Chinese)
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function authError(message: string, details?: string): AIError {
  return {
    category: 'auth',
    stage: 'provider',
    message,
    details,
    recovery: '请在 AI 设置中检查并重新输入凭证。',
    retryable: false,
  };
}

export function rateLimitError(message: string, details?: string): AIError {
  return {
    category: 'rate_limit',
    stage: 'provider',
    message,
    details,
    recovery: '请等待几秒后重试，或切换到其他模型。',
    retryable: true,
  };
}

export function quotaError(message: string, details?: string): AIError {
  return {
    category: 'quota',
    stage: 'provider',
    message,
    details,
    recovery: '当前账户额度已用尽，请检查账户余额或更换 API Key。',
    retryable: false,
  };
}

export function networkError(message: string, details?: string): AIError {
  return {
    category: 'network',
    stage: 'provider',
    message,
    details,
    recovery: '网络连接失败，请检查网络设置或 Base URL 是否正确。',
    retryable: true,
  };
}

export function invalidOutputError(message: string, details?: string): AIError {
  return {
    category: 'invalid_output',
    stage: 'parse',
    message,
    details,
    recovery: '模型返回了无法解析的内容，请重试或切换到支持结构化输出的模型。',
    retryable: true,
  };
}

export function refMissingError(message: string, details?: string): AIError {
  return {
    category: 'ref_missing',
    stage: 'execute',
    message,
    details,
    recovery: 'AI 引用了不存在的元素，请重试或先选中需要操作的元素。',
    retryable: true,
  };
}

export function capabilityError(message: string, details?: string): AIError {
  return {
    category: 'capability',
    stage: 'execute',
    message,
    details,
    recovery: '当前版本不支持该操作类型，请尝试其他指令。',
    retryable: false,
  };
}

export function providerError(message: string, stage: AIErrorStage = 'provider', details?: string): AIError {
  return {
    category: 'provider',
    stage,
    message,
    details,
    recovery: '服务端返回错误，请稍后重试。',
    retryable: true,
  };
}

export function executeError(message: string, details?: string): AIError {
  return {
    category: 'execute',
    stage: 'execute',
    message,
    details,
    recovery: '执行操作时出错，可以撤销（Ctrl+Z）后重试。',
    retryable: true,
  };
}

export function contextError(message: string, details?: string): AIError {
  return {
    category: 'context',
    stage: 'context',
    message,
    details,
    recovery: '读取画布状态失败，请刷新页面后重试。',
    retryable: false,
  };
}

export function unknownError(message: string, stage: AIErrorStage = 'provider', details?: string): AIError {
  return {
    category: 'unknown',
    stage,
    message,
    details,
    recovery: '发生未知错误，请重试。',
    retryable: true,
  };
}

// ---------------------------------------------------------------------------
// Classifier: infer category from raw error strings coming from Tauri / fetch
// ---------------------------------------------------------------------------

const AUTH_PATTERNS = [
  /401/i,
  /unauthorized/i,
  /invalid.*(api|auth|key|token|credential)/i,
  /authentication/i,
  /凭证无效/,
  /密钥/,
];

const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /too many requests/i,
  /请求过于频繁/,
];

const QUOTA_PATTERNS = [
  /402/i,
  /insufficient.?quota/i,
  /billing/i,
  /exceeded.*quota/i,
  /额度/,
];

const NETWORK_PATTERNS = [
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /ETIMEDOUT/i,
  /network/i,
  /dns/i,
  /timeout/i,
  /connection.*refused/i,
  /网络/,
];

export function classifyProviderError(raw: string, stage: AIErrorStage = 'provider'): AIError {
  for (const pattern of AUTH_PATTERNS) {
    if (pattern.test(raw)) return authError(raw);
  }
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(raw)) return rateLimitError(raw);
  }
  for (const pattern of QUOTA_PATTERNS) {
    if (pattern.test(raw)) return quotaError(raw);
  }
  for (const pattern of NETWORK_PATTERNS) {
    if (pattern.test(raw)) return networkError(raw);
  }
  return providerError(raw, stage);
}

export function classifyExecutionError(raw: string): AIError {
  if (/not found/i.test(raw) || /不存在/.test(raw)) {
    return refMissingError(raw);
  }
  if (/unsupported/i.test(raw) || /不支持/.test(raw)) {
    return capabilityError(raw);
  }
  return executeError(raw);
}

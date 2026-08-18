import { useState } from "react";
import { getLatestDevOtp, startAuth, verifyOtp } from "./session-client";

/**
 * 登录页（S2）：邮箱 + OTP / magic link。
 * 开发环境提示从开发收件箱读取验证码（不发送真实邮件）。
 */
export function LoginPage(props: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
 const [error, setError] = useState<string | null>(null);
 const [devOtp, setDevOtp] = useState<string | null>(null);
 const [copied, setCopied] = useState(false);
 const [busy, setBusy] = useState(false);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
    const result = await startAuth(email, "otp");
    if (result.ok) {
     // Vite 会在生产构建中把 DEV 固化为 false；生产页面既不请求也不
     // 渲染本地收件箱里的 OTP。
     const localCode = import.meta.env.DEV ? await getLatestDevOtp(email) : null;
     setDevOtp(localCode);
     setCopied(false);
     setStage("code");
      } else {
        setError(result.message ?? "验证码发送失败，请稍后重试");
      }
    } catch {
      setError("验证码发送失败，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  }

 async function copyDevOtp() {
  if (!devOtp || !navigator.clipboard) return;
  try {
   await navigator.clipboard.writeText(devOtp);
   setCopied(true);
  } catch {
   setCopied(false);
  }
 }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifyOtp(email, code);
      if (result.ok) {
        props.onLoggedIn();
      } else {
        setError(result.message ?? "凭据无效或已过期");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="login-page" className="login-page">
      <h1>登录</h1>
      {stage === "email" ? (
        <form onSubmit={submitEmail}>
          <label htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            发送验证码
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode}>
          <p data-testid="otp-hint">
            验证码已发送（开发环境：请查看服务端开发收件箱）。
          </p>
          {import.meta.env.DEV && devOtp ? (
            <p data-testid="dev-otp" className="dev-otp">
              开发验证码：<code data-testid="dev-otp-code">{devOtp}</code>{" "}
              <button type="button" onClick={() => void copyDevOtp()}>
                {copied ? "已复制" : "复制"}
              </button>
            </p>
          ) : null}
          <label htmlFor="login-code">验证码</label>
          <input
            id="login-code"
            inputMode="numeric"
            pattern="\d{6}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            登录
          </button>
        </form>
      )}
      {error ? (
        <p data-testid="login-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

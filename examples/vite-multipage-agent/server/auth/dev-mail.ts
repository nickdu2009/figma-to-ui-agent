import type { AuthRepository } from "../repositories/auth-repository.ts";

/**
 * 邮件投递端口（设计 §6.1）：输入是已渲染的事务邮件，不返回原始令牌。
 */
export interface RenderedMail {
  to: string;
  subject: string;
  body: string;
}

export interface MailDelivery {
  send(mail: RenderedMail): Promise<void>;
}

/**
 * 本地开发收件箱投递器（AC10）：
 * - 只把邮件写入 dev_mail_inbox 表；
 * - 非开发环境禁止启动（构造即失败，fail-closed）；
 * - 不发送真实邮件，原始令牌只存在于收件箱行内（不落日志）。
 */
export class DevMailDelivery implements MailDelivery {
  private readonly repo: AuthRepository;
  constructor(repo: AuthRepository, env: NodeJS.ProcessEnv = process.env) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "DevMailDelivery 仅允许开发环境启动（NODE_ENV=production 被拒绝）",
      );
    }
    this.repo = repo;
  }

  async send(mail: RenderedMail): Promise<void> {
    await this.repo.saveDevMail({
      toEmail: mail.to,
      subject: mail.subject,
      body: mail.body,
    });
  }
}

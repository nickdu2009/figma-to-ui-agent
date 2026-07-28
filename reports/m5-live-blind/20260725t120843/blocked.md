# M5 live blind blocked report

- runStamp: 20260725t120843
- status: blocked
- scope: live_m5_blind
- openaiCalled: false
- figmaRestCalled: true
- tokenConfigured: true

## 阻塞原因

当前 `.envrc` 中的 Figma token 无法通过 Figma REST API 鉴权：

- `GET /v1/me`: HTTP 403
- `case-a GET /v1/files/<fileKey>`: HTTP 403
- `case-a GET /v1/files/<fileKey>/nodes`: HTTP 403
- `case-b GET /v1/files/<fileKey>`: HTTP 403
- `case-b GET /v1/files/<fileKey>/nodes`: HTTP 403
- `case-c GET /v1/files/<fileKey>`: HTTP 403
- `case-c GET /v1/files/<fileKey>/nodes`: HTTP 403
- `LoginUIConcept GET /v1/files/<fileKey>`: HTTP 403
- `LoginUIConcept GET /v1/files/<fileKey>/nodes`: HTTP 403

## 影响

- 未生成新的 live DesignBundle。
- 未运行新的 live M5 static generation。
- 未生成新的 live UISpec。
- 未生成新的 live render-and-compare 结果。

## 判断

这不是 429 rate limit，也不是 Figma URL/node-id 解析问题。`/v1/me` 也返回 403，优先判断为 token 无效、过期、未启用 REST API 访问，或 token 权限范围不包含 REST 读取当前账号信息和文件内容。

## 后续动作

换用一个能让 `GET /v1/me` 返回 200 的 Figma token 后，再重新执行 live M5 blind。若使用 Personal Access Token，需要为文件读取授予 `file_content:read`，并确保生成 token 的 Figma 账号实际能打开目标文件。

# 自托管部署

目标网址可使用 `https://onemore.chaoanli.com`。当前尚未上线；服务器容量、DNS、HTTPS、真实 SMTP 与 DeepSeek 接入都需要各自验证。中美访问效果应在部署后分别测试。

## 运行环境与配置

现有 Dockerfile 使用 Node 24，SQLite 数据必须持久化。复制 `.env.example` 为 `.env`，填写 `DOMAIN`、`PUBLIC_URL`；实际密码和 API Key 只存在本机环境文件中。

```bash
cp .env.example .env
# 编辑 .env：DOMAIN=onemore.chaoanli.com
# PUBLIC_URL=https://onemore.chaoanli.com

docker compose up -d --build
docker compose logs --tail 80 app caddy
```

域名对应的 DNS A 记录应指向实际服务器公网 IPv4；没有公网 IPv6 就不要增加 AAAA 记录。确认主机防火墙和云网络允许网站的 80/443 入站。SSH 仅向维护者开放。Caddy 自动签发 HTTPS 证书，签发需要正确 DNS 和可达的端口。

Compose 使用 `NODE_ENV=production`。未配置 SMTP 时不会真实发邮件，生产 API 也不会返回演示验证码。发信需要填写 SMTP_HOST、SMTP_PORT、SMTP_USER、SMTP_PASS、MAIL_FROM，并按发信服务商要求配置域名验证；域名 DNS 管理与邮箱收信服务可以分开。

DeepSeek 需要服务端配置 `DEEPSEEK_API_KEY`，客户端不能持有密钥。现有适配器尚需用真实账号验证可用模型、超时和费用；没有 Key 时仍使用明确标注的演示解析。

## 首次使用

打开网站创建账号和空间，在空间管理页生成加入链接。朋友申请后由管理员批准；活动链接不能代替空间加入链接。请绑定并保存账号恢复码，以便换设备后继续使用同一账号。

不要在正式数据库运行演示 seed。需要演示时指定独立的 `DB_PATH`，例如本机的临时数据库。

## 数据与更新

SQLite 文件和自动升级备份位于 `appdata` 卷。旧模型数据默认保留但隔离，见 [迁移说明](LEGACY-MIGRATION.md)。没有空间字段的旧通知、邮件和日历令牌不再使用。

备份运行中的 SQLite 必须通过 SQLite 备份机制或 `VACUUM INTO` 取得一致快照，不能只复制主 `.db` 文件而漏掉 WAL。下面命令在容器内生成快照，再复制到本机；请把备份目录设为仅维护者可读。

```bash
docker compose exec app node --input-type=module -e "import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync('/data/couju.db'); db.exec(\"VACUUM INTO '/data/manual-backup.db'\"); db.close()"
docker compose cp app:/data/manual-backup.db ./onemore-backup.db
```

目标快照文件必须尚不存在；为每次备份使用新名字，并及时保存到独立存储。备份包含私人数据和凭证，不能上传源码仓库。

更新前先备份，然后在服务器拉取已验证版本并执行 `docker compose up -d --build`。恢复时停止 app，恢复数据库并移开旧 WAL/SHM，再启动验证，不要在线覆盖。

## 上线验证

检查健康接口、HTTPS、同账号切换两空间、外空间活动拒绝访问、管理员批准与移除、日历令牌撤销。用中国大陆和美国的实际网络分别测试首页、API 和活动报名。真实 SMTP 和 DeepSeek 需另外验证；本地测试通过不代表外部服务已接通。

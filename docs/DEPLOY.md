# 部署到 chaoanli.com（含域名邮箱发提醒）

目标：朋友在手机上打开 `https://onemore.chaoanli.com` 就能用；提醒邮件从 `notify@chaoanli.com` 发出。

整个过程大约 30–60 分钟，分 6 步。不需要懂运维，照着复制命令即可。

---

## 第 0 步：先想好两件事

1. **用哪个网址**：建议用子域名 `onemore.chaoanli.com`，主域名 `chaoanli.com` 留着以后做别的。下文都以它为例。
2. **服务器放哪**：朋友大多在国内，建议选 **香港 / 东京 / 新加坡** 机房。
   - ❌ 不要选中国大陆机房：大陆服务器绑定域名需要 ICP 备案，你人在美国、域名在海外注册，备案很难办。
   - 香港/东京访问国内通常比较快，也不需要备案。

## 第 1 步：买一台小服务器（每月几美元）

任选一家，配置 **1 核 CPU、1–2 GB 内存、Ubuntu 24.04** 就够朋友圈用：

- 腾讯云 轻量应用服务器（选“中国香港”）
- 阿里云国际站 / 轻量应用服务器（选“中国香港”）
- Vultr、DigitalOcean、Linode（选 Tokyo 或 Singapore）

买好后记下两样东西：**服务器 IP 地址**（例如 `43.xxx.xxx.xxx`）和 **root 密码**（或 SSH 密钥）。

防火墙/安全组里放行端口 **22、80、443**（很多云默认只开 22）。

## 第 2 步：把域名指向服务器

登录 Northwest 后台 → 找到 `chaoanli.com` 的 **DNS 设置** → 添加一条记录：

| 类型 | 主机名（Host / Name） | 值（Value / Points to） | TTL |
|---|---|---|---|
| A | `onemore` | 你的服务器 IP | 默认 |

⚠️ 不要动已有的 **MX** 记录，那是邮箱用的。

生效一般几分钟到一小时。在电脑终端里检查：

```bash
ping onemore.chaoanli.com   # 显示的 IP 是你的服务器就对了
```

## 第 3 步：服务器上装 Docker

在 Mac 终端里登录服务器（把 IP 换成你的）：

```bash
ssh root@你的服务器IP
```

登录后执行：

```bash
curl -fsSL https://get.docker.com | sh
docker --version   # 能看到版本号就装好了
```

## 第 4 步：把代码传上去

**在你自己的 Mac 上**（新开一个终端窗口），进入项目目录执行：

```bash
cd ~/Documents/OneMore
rsync -av --exclude node_modules --exclude dist --exclude apps/server/data --exclude .env ./ root@你的服务器IP:/opt/onemore/
```

## 第 5 步：拿到邮箱的发信设置，写配置文件

### 5.1 在 Northwest 后台找邮箱设置

进入邮箱管理（Email / Business Email），先创建一个发信用的地址，比如 `notify@chaoanli.com`（用你那个免费名额即可，也可以直接用你自己的邮箱）。

然后找 **“邮件客户端设置 / Mail client setup / IMAP & SMTP settings”** 之类的页面，记下这 4 项：

| 需要的 | 长什么样 |
|---|---|
| SMTP 服务器 | 例如 `smtp.xxxx.com` 或 `mail.chaoanli.com` |
| 端口 | 通常是 `465`（SSL）或 `587`（STARTTLS） |
| 用户名 | 通常是完整邮箱 `notify@chaoanli.com` |
| 密码 | 这个邮箱的密码（有的服务要求单独生成“应用密码”） |

找不到的话，直接问 Northwest 客服：“I want to send email from my app via SMTP. What are the SMTP host, port and username for my mailbox?”

### 5.2 防止进垃圾箱（很重要）

在同一个 DNS 设置页，确认有这三类记录（邮箱设置页一般会给出具体值；没有的话问客服要）：

- **SPF**：一条 TXT 记录，值以 `v=spf1` 开头
- **DKIM**：一条 TXT（或 CNAME）记录，主机名里带 `_domainkey`
- **DMARC**：主机名 `_dmarc`，值例如 `v=DMARC1; p=none`

没有这些，QQ / 163 邮箱很可能把提醒当垃圾邮件。

### 5.3 写 .env

回到服务器的终端：

```bash
cd /opt/onemore
cp .env.example .env
nano .env
```

填成这样（替换成你的真实值）：

```bash
DOMAIN=onemore.chaoanli.com
PUBLIC_URL=https://onemore.chaoanli.com

SMTP_HOST=第5.1步查到的服务器
SMTP_PORT=465
SMTP_USER=notify@chaoanli.com
SMTP_PASS=邮箱密码
MAIL_FROM=算我一个 <notify@chaoanli.com>
# 如果端口是 587，再加一行：
# SMTP_SECURE=false
```

`nano` 里按 `Ctrl+O` 回车保存，`Ctrl+X` 退出。

## 第 6 步：启动

```bash
cd /opt/onemore
docker compose up -d --build
```

第一次会构建几分钟。完成后：

```bash
docker compose logs -f app     # 看到“SMTP 已配置，会真的发出”和“API 已启动”就对了；Ctrl+C 退出查看
```

用手机打开 **https://onemore.chaoanli.com** 🎉（第一次打开时 Caddy 会自动申请 HTTPS 证书，可能要等几十秒）。

### 测试邮件

在网页里进入“我 → 邮件提醒”，填你自己的邮箱、收验证码。收到了就说明发信通了；没收到先看垃圾箱，再看日志：

```bash
docker compose logs app | grep 邮件
```

---

## 以后常用的操作

**更新代码**（在 Mac 上改完后）：

```bash
# Mac 上
rsync -av --exclude node_modules --exclude dist --exclude apps/server/data --exclude .env ./ root@你的服务器IP:/opt/onemore/
# 服务器上
cd /opt/onemore && docker compose up -d --build
```

**备份数据**（所有用户、活动都在一个 SQLite 文件里）：

```bash
docker compose cp app:/data/couju.db ./couju-backup-$(date +%F).db
```

**看日志 / 重启**：

```bash
docker compose logs -f app
docker compose restart app
```

## 已知的现实问题

- **微信里打开**：未备案域名在微信里打开，有时会先出现“非微信官方网页”的提示，点“继续访问”即可；如果链接被大量举报，可能被拦截。熟人之间使用一般没问题。
- **免费域名邮箱的发信量**：通常每天有上限（几百封级别），朋友圈规模足够。
- **日历订阅**：部署后在“日历”页重新生成订阅链接，手机日历才能访问到。
- **手机日历 / 邮件里的链接**都依赖 `PUBLIC_URL`，务必填对。

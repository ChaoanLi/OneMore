# Security reports

Please do not put secrets, exploit details involving private data, or real
account recovery codes into public issues. Use GitHub's private vulnerability
reporting if it is enabled for this repository, or contact the maintainer through
a private channel you already share. No dedicated security inbox or response SLA
is currently operated by this project.

For self-hosting: use HTTPS, keep backend credentials out of the client, protect
and back up the SQLite database, and treat recovery codes, session tokens and
calendar URLs as private credentials. The current guest sessions are long-lived;
there is no device/session management UI. See [deployment notes](docs/DEPLOY.md)
and [verification limits](docs/VERIFICATION.md).

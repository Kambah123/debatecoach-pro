# Security Guide

## 🔐 Key Management

### Wallet Security
- Private keys are stored in `~/.solaire/config.yaml`
- File permissions should be 600 (read/write owner only)
- Never commit config files to git
- Use environment variables in production

### Telegram Security
- Use dedicated Telegram account (not personal)
- Enable 2FA on Telegram
- Store session string securely after first login
- Use allowlist policy for groups

## 🛡️ Runtime Security

### Input Sanitization
- All user inputs are sanitized before processing
- Markdown injection is prevented
- Unicode normalization applied

### Access Policies

**DM Policies:**
- `open`: Respond to all DMs
- `allowlist`: Only respond to admin IDs
- `pairing`: Only respond to paired users
- `disabled`: No DM responses

**Group Policies:**
- `open`: Respond to all messages (with mention check)
- `allowlist`: Only respond in allowed groups
- `disabled`: No group responses

### Transaction Safety
- All transactions require explicit confirmation
- Slippage protection on swaps (default 0.5%)
- Address validation before transfers
- Balance checks before operations

## 🚨 Emergency Procedures

### Pause Agent
Send `/pause` from admin account

### Stop Agent
Send `/stop` from admin account

### Revoke Session
1. Delete `~/.solaire/config.yaml`
2. Revoke Telegram session at my.telegram.org
3. Generate new wallet if compromised

## 📋 Security Checklist

- [ ] Private key backed up offline
- [ ] Telegram 2FA enabled
- [ ] Admin IDs configured correctly
- [ ] File permissions set (chmod 600)
- [ ] Environment variables in production
- [ ] Logs don't contain sensitive data
- [ ] Regular dependency updates

## 🐛 Reporting Vulnerabilities

Contact: security@solaire.bot

DO NOT open public issues for security problems.

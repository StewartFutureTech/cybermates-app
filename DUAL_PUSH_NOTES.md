# Cybermates dual-remote push notes

Clone path: `/workspace/cybermates-git` (real history from GitHub; do not invent commits).

## Remotes
- `origin` fetch: https://github.com/dstewart3919/cybermates-app.git
- `origin` push (dual):
  - https://github.com/dstewart3919/cybermates-app.git
  - https://github.com/StewartFutureTech/cybermates-app.git
- `sft` fetch+push: https://github.com/StewartFutureTech/cybermates-app.git

`main` tracks `origin/main`.

## Dual-push commands (keep BOTH updated)
Preferred (one command pushes both via origin's two push URLs):
```bash
cd /workspace/cybermates-git
git push origin main
```

Explicit both remotes:
```bash
git push origin main && git push sft main
```

Tags (if any):
```bash
git push origin --tags && git push sft --tags
```

## Verify same SHA
```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
git ls-remote sft refs/heads/main
```

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

```./commit-deploy.sh```
to push a change to github

```brew install fswatch```
```fswatch ./pages | xargs -n1 -I{} ./build.sh``` to rebuild on file changes

```node scripts/wifi-dev.js``` to run wifi server locally

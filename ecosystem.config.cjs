module.exports = {
  apps: [
    {
      name: 'json-drop',
      script: 'server.ts',
      interpreter: 'bun',
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 11099,
      },
    },
  ],
}

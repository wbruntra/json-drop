module.exports = {
  apps: [
    {
      name: 'json-drop',
      script: 'index.ts',
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

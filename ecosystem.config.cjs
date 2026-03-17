module.exports = {
  apps: [
    {
      name: 'intelligex-crm',
      cwd: '/root/CRM',
      script: 'server.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 8087
      }
    }
  ]
};

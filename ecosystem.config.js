module.exports = {
  apps: [
    {
      name:               'orobot-firmware',
      script:             'dist/index.js',
      restart_delay:      2000,
      max_restarts:       10,
      max_memory_restart: '200M',
      autorestart:        true,
      env: {
        NODE_ENV:  'production',
        LOG_LEVEL: 'info',
      },
    },
  ],
};

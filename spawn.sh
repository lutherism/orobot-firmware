#!/usr/bin/env bash

## run
## chmod 777 ./spawn.sh && chmod 777 ./reboot.sh && spawn.sh

BASEDIR=$(dirname "$0")
## Install Operating System from Raw Raspberry Pi and git clone
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.37.2/install.sh | bash

source /home/pi/.bashrc

nvm install 8

nvm use 8

npm install

/root/.nvm/versions/node/v8.17.0/bin/node $BASEDIR/scripts/factory-reset.js

#!/usr/bin/env bash

BASEDIR="/home/pi/orobot-firmware"
nvm use 8
NODE_BIN="/root/.nvm/versions/node/v8.17.0/bin/node"

$LOGNAME="reset.log"

#!/bin/bash
mkdir tmp
touch tmp/$LOGNAME
export DISPLAY=:0 #needed if you are running a simple gui app.

process="v8.17.0/bin/node"
wificlient="sudo $BASEDIR/switch-to-wifi-client.sh"
makerun="sudo $NODE_BIN $BASEDIR/scripts/camera-factory-reset.js >> tmp/$LOGNAME"
initDCP="cp $BASEDIR/autostart/* /etc/xdg/autostart/"

echo Running resets.

echo $wificlient | bash

while [ "$(hostname -I)" = "" ]; do
  echo -e "\e[1A\e[KNo network: $(date)"
  sleep 1
done

echo $makerun | bash
echo $initDCP | bash

exit

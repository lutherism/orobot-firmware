#!/usr/bin/env bash

BASEDIR="/home/pi/orobot-firmware"
nvm use 8
NODE_BIN="/home/pi/.config/nvm/versions/node/v8.17.0/bin/node"

$LOGNAME="reset.log"

#!/bin/bash
mkdir tmp
touch tmp/$LOGNAME
echo $(date) Run >> $BASEDIR/tmp/reboot.log
export DISPLAY=:0 #needed if you are running a simple gui app.

process="v8.17.0/bin/node"
makecron="crontab $BASEDIR/reboot.cron"
makerun="sudo $NODE_BIN $BASEDIR/scripts/factory-reset.js >> tmp/$LOGNAME"
initDCP="cp $BASEDIR/autostart/* /etc/xdg/autostart/"

echo Running resets.
echo $makecron | bash
echo $makerun | bash
echo $initDCP | bash

exit

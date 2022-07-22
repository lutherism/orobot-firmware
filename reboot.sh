#!/usr/bin/env bash

BASEDIR="/home/pi/orobot-firmware"
NODE_BIN="/home/pi/.config/nvm/versions/node/v8.17.0/bin/node"

#!/bin/bash
mkdir tmp
touch tmp/reboot.log
touch tmp/run.log
touch tmp/run-err.log
echo "$(date) Run" >> $BASEDIR/tmp/reboot.log
export DISPLAY=:0 #needed if you are running a simple gui app.

process="keep-alive.js"
makerun="sudo $NODE_BIN $BASEDIR/scripts/keep-alive.js >> $BASEDIR/tmp/run.log 2>> $BASEDIR/tmp/run-err.log"
camprocess="keep-alive.js"
cammakerun="sudo python3 $BASEDIR/scripts/python/rpi_camera_surveillance_system.py >> $BASEDIR/tmp/run.log 2>> $BASEDIR/tmp/run-err.log"
echo Running $makerun

if ps ax | grep -v grep | grep "$process" > /dev/null
then
    echo 'Already running node' >> $BASEDIR/tmp/reboot.log;
    exit
else
    echo 'running.'
    echo "$makerun" | bash >> $BASEDIR/tmp/reboot.log &
fi

if ps ax | grep -v grep | grep "$camprocess" > /dev/null
then
    echo 'Already running python' >> $BASEDIR/tmp/reboot.log;
    exit
else
    echo 'running.'
    echo "$cammakerun" | bash >> $BASEDIR/tmp/reboot.log &
fi

exit

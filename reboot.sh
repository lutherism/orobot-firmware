#!/usr/bin/env bash

BASEDIR="/home/pi/orobot-firmware"
NODE_BIN="/root/.nvm/versions/node/v8.17.0/bin/node"

#!/bin/bash
mkdir tmp
touch tmp/run.log
touch tmp/run-err.log
echo "$(date) Run" >> $BASEDIR/tmp/run.log
export DISPLAY=:0 #needed if you are running a simple gui app.

process="keep-alive.js"
makerun="sudo $NODE_BIN $BASEDIR/scripts/keep-alive.js >> $BASEDIR/tmp/run.log 2>> $BASEDIR/tmp/run.log"
camprocess="rpi_camera_surveillance_system.py"
cammakerun="sudo python3 $BASEDIR/scripts/python/rpi_camera_surveillance_system.py >> $BASEDIR/tmp/run.log 2>> $BASEDIR/tmp/run.log"
echo Running $makerun >> $BASEDIR/tmp/run.log;
echo Running $cammakerun >> $BASEDIR/tmp/run.log;
if ps ax | grep -v grep | grep "$process" > /dev/null
then
    echo 'Already running node' >> $BASEDIR/tmp/run.log;
else
    echo 'running node.' >> $BASEDIR/tmp/run.log;
    echo "$makerun" | bash >> $BASEDIR/tmp/run.log &
fi

if jq .type $BASEDIR/scripts/openroboticsdata/data.json | grep wifi-camera > /dev/null
then
  if ps ax | grep -v grep | grep "$camprocess" > /dev/null
  then
      echo 'Already running python' >> $BASEDIR/tmp/run.log;
  else
      echo 'running python.'
      echo "$cammakerun" | bash >> $BASEDIR/tmp/run.log &
  fi
fi

exit

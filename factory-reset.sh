#!/usr/bin/env bash

BASEDIR=$(dirname "$0")
nvm use 8

$LOGNAME="reset.log"

#!/bin/bash
mkdir tmp
touch tmp/$LOGNAME
echo $(date) Run >> $BASEDIR/tmp/reboot.log
export DISPLAY=:0 #needed if you are running a simple gui app.

process="v8.17.0/bin/node"
makecron="crontab $BASEDIR/reboot.cron"
makerun="node $BASEDIR/scripts/factory-reset.js >> tmp/$LOGNAME"
initDCP="cp $BASEDIR/init.d/* /etc/init.d/"

echo Running $makerun
echo $makecron | bash
echo $makerun | bash
echo $initDCP | bash

exit

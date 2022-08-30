#!/usr/bin/env bash

ps -aux | grep -v grep | grep keep-alive.js | awk '{print $2}' | xargs kill
ps -aux | grep -v grep | grep rpi_camera_surveillance_system.py | awk '{print $2}' | xargs kill

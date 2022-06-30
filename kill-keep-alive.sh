#!/usr/bin/env bash

ps -aux | grep -v grep | grep keep-alive.js | awk '{print $2}' | xargs kill

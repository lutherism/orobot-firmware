#!/usr/bin/env bash

ps -aux | grep -v grep | grep ap-server.js | awk '{print $2}' | xargs kill

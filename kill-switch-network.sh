sudo kill $(ps -ax | grep 'switch-to' | awk '{print $1}')

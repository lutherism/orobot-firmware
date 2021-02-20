import fs from 'fs';

export default function syncWithUser(userUuid) {
  fs.write('./openroboticsdata/data.json', JSON.stringify({
    userUuid
  }));
}

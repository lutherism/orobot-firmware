# PlatformIO pre-script: regenerate src/portal_html.h from portal/index.html.
#
# Shells out to node so the generation logic stays in JS (shared with the
# `npm run portal-dev` workflow). Best-effort: if node isn't installed we log
# and continue — the committed header is still valid for the build, it just
# won't reflect any uncommitted edits to index.html.

import os
import shutil
import subprocess

Import("env")  # noqa: F821  (provided by PlatformIO at runtime)

# PlatformIO SCons exec()'s this file without setting __file__, so derive
# the location from $PROJECT_DIR instead.
project_dir = env.subst("$PROJECT_DIR")  # noqa: F821
script = os.path.join(project_dir, "portal", "build.mjs")

if not shutil.which("node"):
    print("portal/build.py: node not found on PATH; skipping HTML regen "
          "(committed src/portal_html.h will be used as-is)")
else:
    try:
        subprocess.check_call(["node", script])
    except subprocess.CalledProcessError as e:
        # Don't fail the build over a portal-asset issue; surface and proceed.
        print(f"portal/build.py: node {script} exited {e.returncode}; "
              "continuing with committed src/portal_html.h")

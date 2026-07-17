# tepna-capture — pytest bootstrap
# Copyright 2026 Michal Planicka · SPDX-License-Identifier: Apache-2.0
# Put capture-host/ on sys.path so tests can `import oxyii` etc. regardless of pytest version/cwd.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

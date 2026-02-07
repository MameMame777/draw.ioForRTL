# Third-Party Software Licenses

DrawWave uses the following third-party software components:

## draw.io (diagrams.net)

- **License**: Apache License 2.0
- **Source**: https://github.com/jgraph/drawio
- **Copyright**: Copyright (c) JGraph Ltd
- **Usage**: Bundled as offline webapp for block diagram editing

### Apache License 2.0 Summary

The Apache License 2.0 is a permissive license that allows:
- Commercial use
- Modification
- Distribution
- Private use

Under the condition that:
- License and copyright notice must be included
- Changes must be stated

Full license text: https://www.apache.org/licenses/LICENSE-2.0

---

## WaveDrom

- **License**: MIT License
- **Source**: https://github.com/wavedrom/wavedrom
- **Copyright**: Copyright (c) 2014-present WaveDrom contributors
- **Usage**: npm dependency for timing diagram rendering

### MIT License Summary

The MIT License is a permissive license that allows:
- Commercial use
- Modification
- Distribution
- Private use

Under the condition that:
- License and copyright notice must be included

Full license text: https://opensource.org/licenses/MIT

---

## onml

- **License**: MIT License
- **Source**: https://github.com/wavedrom/onml
- **Copyright**: Copyright (c) WaveDrom contributors
- **Usage**: npm dependency for JSON-ML to XML conversion

### MIT License (same as above)

---

## License Compatibility

DrawWave is licensed under GPL-3.0, which is compatible with:
- Apache License 2.0 ✓
- MIT License ✓

Both Apache 2.0 and MIT are permissive licenses that can be combined with GPL-3.0.
The resulting work (DrawWave) must be distributed under GPL-3.0.

---

## Obtaining Source Code

All third-party components are obtained from their official sources:

1. **draw.io**: Downloaded via `npm run setup-drawio` from GitHub releases
2. **WaveDrom / onml**: Installed via `npm install` from npm registry

No pre-compiled binaries are included in the repository. All components are downloaded
during build/setup process.

---

## Full License Texts

### Apache License 2.0
https://www.apache.org/licenses/LICENSE-2.0.txt

### MIT License
https://opensource.org/licenses/MIT

### GNU General Public License v3.0
https://www.gnu.org/licenses/gpl-3.0.txt

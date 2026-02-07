const wd = require('wavedrom');
const onml = require('onml');
const fs = require('fs');

const src = { signal: [{ name: 'clk', wave: 'p...' }] };
const arr = wd.renderAny(0, src, wd.waveSkin);
let svg = onml.stringify(arr);

// Add white background
svg = svg.replace(/(<svg[^>]*>)/, '$1<rect width="100%" height="100%" fill="white"/>');

const b64 = Buffer.from(svg).toString('base64');
const uri = 'data:image/svg+xml;base64,' + b64;

// Also test with encodeURIComponent approach
const uriEnc = 'data:image/svg+xml,' + encodeURIComponent(svg);

fs.writeFileSync('test_wavedrom.html', `<html><body>
<h1>Base64</h1>
<img src="${uri}" style="border:1px solid red"/>
<h1>URI encoded</h1>
<img src="${uriEnc}" style="border:1px solid red"/>
<h1>Inline</h1>
${svg}
</body></html>`);

console.log('SVG length:', svg.length);
console.log('Base64 length:', b64.length);
console.log('Written test_wavedrom.html');

// Check the library entry to see the actual XML
const libXml = fs.readFileSync('media/drawio-wavedrom-library.xml', 'utf-8');
const match = libXml.match(/<mxlibrary>([\s\S]*)<\/mxlibrary>/);
const entries = JSON.parse(match[1]);
console.log('\nLibrary entry 0 style substring:');
const xmlStr = entries[0].xml;
const styleMatch = xmlStr.match(/style="([^"]{0,200})/);
console.log(styleMatch ? styleMatch[1] : 'no style found');
console.log('\nXML length of entry 0:', xmlStr.length);

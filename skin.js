const SKIN = String.raw`<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:s="https://github.com/nturley/netlistsvg">
  <!-- ELK options live in layout.js; netlistsvg only reads the flags below. -->
  <s:properties constants="false" splitsAndJoins="false" genericsLaterals="false"/>
<style>
svg { stroke: #000; fill: none; }
text { fill: #000; stroke: none; font-size: 10px; font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace; }
.ref { font-weight: bold; }
.val { fill: #555; font-size: 9px; }
.nodelabel { text-anchor: middle; }
.inputPortLabel { text-anchor: end; }
.symbol { stroke-linejoin: round; stroke-linecap: round; stroke-width: 1.5; }
.detail { fill: #000; }
.flag { fill: #eef; }
</style>

<!-- rails: one stub per pin -->
<g s:type="vcc" s:width="20" s:height="22" transform="translate(5,20)">
  <s:alias val="vcc"/>
  <text x="10" y="-4" class="nodelabel ref $cell_id" s:attribute="name">VDD</text>
  <path d="M0,0 H20 L10,10 Z M10,10 V22" class="symbol $cell_id"/>
  <g s:x="10" s:y="22" s:pid="A" s:position="bottom"/>
</g>
<g s:type="gnd" s:width="20" s:height="22" transform="translate(40,20)">
  <s:alias val="gnd"/>
  <text x="24" y="20" class="ref $cell_id" s:attribute="name">VSS</text>
  <path d="M10,0 V12 M0,12 H20 M4,17 H16 M8,22 H12" class="symbol $cell_id"/>
  <g s:x="10" s:y="0" s:pid="A" s:position="top"/>
</g>

<!-- net labels (gates and dangling pins) and cell ports -->
<g s:type="netlabel_l" s:width="60" s:height="12" transform="translate(150,20)">
  <s:alias val="netlabel_l"/>
  <text x="6" y="10" class="ref $cell_id" s:attribute="name">net</text>
  <path d="M0,6 H6" class="$cell_id"/>
  <g s:x="0" s:y="6" s:pid="A" s:position="left"/>
</g>
<g s:type="port_in" s:width="70" s:height="16" transform="translate(220,20)">
  <s:alias val="port_in"/>
  <text x="50" y="12" class="inputPortLabel ref $cell_id" s:attribute="name">in</text>
  <path d="M55,0 V16 H62 L70,8 62,0 Z" class="flag $cell_id"/>
  <g s:x="70" s:y="8" s:pid="A" s:position="right"/>
</g>
<g s:type="port_out" s:width="70" s:height="16" transform="translate(300,20)">
  <s:alias val="port_out"/>
  <text x="20" y="12" class="ref $cell_id" s:attribute="name">out</text>
  <path d="M15,0 V16 H8 L0,8 8,0 Z" class="flag $cell_id"/>
  <g s:x="0" s:y="8" s:pid="A" s:position="left"/>
</g>

<!-- MOSFETs: gate net name drawn inside the symbol (no wire), channel vertical.
     PMOS source on top, NMOS drain on top. 70px left margin holds the gate label. -->
<g s:type="nmos" s:width="220" s:height="40" transform="translate(5,60)">
  <s:alias val="nmos"/>
  <text x="66" y="24" class="inputPortLabel gate $cell_id" s:attribute="gate">A</text>
  <text x="100" y="12" class="ref $cell_id" s:attribute="ref">M1</text>
  <text x="100" y="23" class="val $cell_id" s:attribute="model">nch</text>
  <text x="100" y="34" class="val $cell_id" s:attribute="value">W/L</text>
  <path d="M68,20 H80 M80,11 V29 M84,10 V30 M84,14 H94 V0 M84,26 H94 V40" class="symbol $cell_id"/>
  <path d="M84,26 L90,23 V29 Z" class="detail $cell_id"/>
  <g s:x="94" s:y="0" s:pid="D" s:position="top"/>
  <g s:x="94" s:y="40" s:pid="S" s:position="bottom"/>
</g>
<g s:type="pmos" s:width="220" s:height="40" transform="translate(240,60)">
  <s:alias val="pmos"/>
  <text x="66" y="24" class="inputPortLabel gate $cell_id" s:attribute="gate">A</text>
  <text x="100" y="12" class="ref $cell_id" s:attribute="ref">M1</text>
  <text x="100" y="23" class="val $cell_id" s:attribute="model">pch</text>
  <text x="100" y="34" class="val $cell_id" s:attribute="value">W/L</text>
  <path d="M68,20 H75 M81,11 V29 M84,10 V30 M84,14 H94 V0 M84,26 H94 V40" class="symbol $cell_id"/>
  <circle cx="78" cy="20" r="3" class="symbol $cell_id"/>
  <path d="M90,14 L84,11 V17 Z" class="detail $cell_id"/>
  <g s:x="94" s:y="0" s:pid="S" s:position="top"/>
  <g s:x="94" s:y="40" s:pid="D" s:position="bottom"/>
</g>

<!-- passives, vertical -->
<g s:type="resistor_v" s:width="60" s:height="50" transform="translate(5,120)">
  <s:alias val="r_v"/>
  <text x="15" y="20" s:attribute="name" class="ref $cell_id">R1</text>
  <text x="15" y="32" s:attribute="value" class="val $cell_id">1k</text>
  <path d="M0,10 V40 H10 V10 Z" class="symbol $cell_id"/>
  <path d="M5,0 V10 M5,40 V50" class="$cell_id"/>
  <g s:x="5" s:y="0" s:pid="A" s:position="top"/>
  <g s:x="5" s:y="50" s:pid="B" s:position="bottom"/>
</g>
<g s:type="capacitor_v" s:width="70" s:height="50" transform="translate(80,120)">
  <s:alias val="c_v"/>
  <text x="25" y="20" s:attribute="name" class="ref $cell_id">C1</text>
  <text x="25" y="32" s:attribute="value" class="val $cell_id">1p</text>
  <path d="M0,20 H30 M0,30 H30" class="symbol $cell_id"/>
  <path d="M15,0 V20 M15,30 V50" class="$cell_id"/>
  <g s:x="15" s:y="0" s:pid="A" s:position="top"/>
  <g s:x="15" s:y="50" s:pid="B" s:position="bottom"/>
</g>
<g s:type="inductor_v" s:width="60" s:height="50" transform="translate(160,120)">
  <s:alias val="l_v"/>
  <text x="15" y="20" s:attribute="name" class="ref $cell_id">L1</text>
  <text x="15" y="32" s:attribute="value" class="val $cell_id">1n</text>
  <path d="M5,5 A5,5 0 0 1 5,15 A5,5 0 0 1 5,25 A5,5 0 0 1 5,35 A5,5 0 0 1 5,45" class="$cell_id"/>
  <path d="M5,0 V5 M5,45 V50" class="$cell_id"/>
  <g s:x="5" s:y="0" s:pid="A" s:position="top"/>
  <g s:x="5" s:y="50" s:pid="B" s:position="bottom"/>
</g>
<g s:type="diode_v" s:width="60" s:height="50" transform="translate(230,120)">
  <s:alias val="d_v"/>
  <text x="25" y="20" s:attribute="name" class="ref $cell_id">D1</text>
  <text x="25" y="32" s:attribute="value" class="val $cell_id">dio</text>
  <path d="M0,15 H20 L10,35 Z M0,35 H20" class="symbol $cell_id"/>
  <path d="M10,0 V15 M10,35 V50" class="$cell_id"/>
  <g s:x="10" s:y="0" s:pid="+" s:position="top"/>
  <g s:x="10" s:y="50" s:pid="-" s:position="bottom"/>
</g>

<!-- sub-circuit instance box: type on top, instance name below -->
<g s:type="generic" s:width="60" s:height="40" transform="translate(5,200)">
  <text x="30" y="-4" class="nodelabel ref $cell_id" s:attribute="ref">generic</text>
  <text x="30" y="-15" class="nodelabel val $cell_id" s:attribute="name">X1</text>
  <rect width="60" height="40" x="0" y="0" s:generic="body" class="symbol $cell_id"/>
  <g transform="translate(60,10)" s:x="60" s:y="10" s:pid="out0" s:position="right">
    <text x="5" y="-4" class="$cell_id">out0</text>
  </g>
  <g transform="translate(60,30)" s:x="60" s:y="30" s:pid="out1" s:position="right">
    <text x="5" y="-4" class="$cell_id">out1</text>
  </g>
  <g transform="translate(0,10)" s:x="0" s:y="10" s:pid="in0" s:position="left">
    <text x="-3" y="-4" class="inputPortLabel $cell_id">in0</text>
  </g>
  <g transform="translate(0,30)" s:x="0" s:y="30" s:pid="in1" s:position="left">
    <text x="-3" y="-4" class="inputPortLabel $cell_id">in1</text>
  </g>
</g>
</svg>
`;
if (typeof module !== "undefined") module.exports = SKIN;

// Built-in example netlists (CDL/HSPICE style). Also used by test.js.
const EXAMPLES = {
inv: `* inverter
.SUBCKT INV A Z VDD VSS
MP0 Z A VDD VDD pch W=0.2u L=0.03u
MN0 Z A VSS VSS nch W=0.1u L=0.03u
.ENDS
`,
nand2: `* 2-input NAND: parallel PMOS, series NMOS
.SUBCKT NAND2 A B Z VDD VSS
MP0 Z A VDD VDD pch W=0.2u L=0.03u
MP1 Z B VDD VDD pch W=0.2u L=0.03u
MN0 Z A n1 VSS nch W=0.2u L=0.03u
MN1 n1 B VSS VSS nch W=0.2u L=0.03u
.ENDS
`,
nor2: `* 2-input NOR: series PMOS, parallel NMOS
.SUBCKT NOR2 A B Z VDD VSS
MP0 p1 A VDD VDD pch W=0.4u L=0.03u
MP1 Z B p1 VDD pch W=0.4u L=0.03u
MN0 Z A VSS VSS nch W=0.1u L=0.03u
MN1 Z B VSS VSS nch W=0.1u L=0.03u
.ENDS
`,
aoi21: `* AOI21: Z = !((A & B) | C)
.SUBCKT AOI21 A B C Z VDD VSS
MP0 p1 A VDD VDD pch W=0.3u L=0.03u
MP1 p1 B VDD VDD pch W=0.3u L=0.03u
MP2 Z C p1 VDD pch W=0.3u L=0.03u
MN0 Z A n1 VSS nch W=0.2u L=0.03u
MN1 n1 B VSS VSS nch W=0.2u L=0.03u
MN2 Z C VSS VSS nch W=0.1u L=0.03u
.ENDS
`,
sram6t: `* 6T SRAM bitcell, X-style MOS instances (foundry CDL)
.SUBCKT SRAM6T BL BLB WL VDD VSS
XPU0 Q QB VDD VDD pch_lvt W=0.06u L=0.03u nfin=1
XPU1 QB Q VDD VDD pch_lvt W=0.06u L=0.03u nfin=1
XPD0 Q QB VSS VSS nch_lvt W=0.09u L=0.03u nfin=2
XPD1 QB Q VSS VSS nch_lvt W=0.09u L=0.03u nfin=2
XPG0 BL WL Q VSS nch_lvt W=0.07u L=0.03u nfin=1
XPG1 BLB WL QB VSS nch_lvt W=0.07u L=0.03u nfin=1
.ENDS
`,
mux2_tgate: `* 2:1 transmission-gate mux with local select inverter
.SUBCKT MUX2 D0 D1 S Z VDD VSS
MP_SB SB S VDD VDD pch W=0.2u L=0.03u
MN_SB SB S VSS VSS nch W=0.1u L=0.03u
MP0 Z SB D0 VDD pch W=0.2u L=0.03u $ passes D0 when S=0
MN0 D0 S Z VSS nch W=0.1u L=0.03u
MP1 Z S D1 VDD pch W=0.2u L=0.03u $ passes D1 when S=1
MN1 D1 SB Z VSS nch W=0.1u L=0.03u
.ENDS
`,
mux4_hier: `* 4:1 mux built from 2:1 tgate muxes and an inverter (hierarchical)
.SUBCKT INV A Z VDD VSS
MP0 Z A VDD VDD pch W=0.2u L=0.03u
MN0 Z A VSS VSS nch W=0.1u L=0.03u
.ENDS

.SUBCKT MUX2 D0 D1 S Z VDD VSS
XI0 S SB VDD VSS / INV
MP0 Z SB D0 VDD pch W=0.2u L=0.03u
MN0 D0 S Z VSS nch W=0.1u L=0.03u
MP1 Z S D1 VDD pch W=0.2u L=0.03u
MN1 D1 SB Z VSS nch W=0.1u L=0.03u
.ENDS

.SUBCKT MUX4 D0 D1 D2 D3 S0 S1 Z VDD VSS
XM0 D0 D1 S0 m0 VDD VSS / MUX2
XM1 D2 D3 S0 m1 VDD VSS / MUX2
XM2 m0 m1 S1 Z VDD VSS / MUX2
.ENDS
`,
levelshifter: `* cross-coupled PMOS level shifter, VDDL -> VDDH
.SUBCKT LS IN OUT VDDL VDDH VSS
MPI INB IN VDDL VDDL pch W=0.2u L=0.03u
MNI INB IN VSS VSS nch W=0.1u L=0.03u
MP0 n0 OUT VDDH VDDH pch W=0.3u L=0.1u
MP1 OUT n0 VDDH VDDH pch W=0.3u L=0.1u
MN0 n0 IN VSS VSS nch W=0.4u L=0.1u
MN1 OUT INB VSS VSS nch W=0.4u L=0.1u
.ENDS
`,
cdl_pins: `* CDL named-pin instances and .model based type detection
.MODEL pfet PMOS
.MODEL nfet NMOS
.SUBCKT BUF A Z VDD VSS
XI0 / INV $PINS A=A Z=n Z2=x VDD=VDD VSS=VSS
XI1 / INV $PINS A=n Z=Z VDD=VDD VSS=VSS
.ENDS
.SUBCKT INV A Z VDD VSS
+ / W=1u
M0 Z A VDD VDD pfet W=W L=0.1u
M1 Z A VSS VSS nfet W=W L=0.1u
.ENDS
`,
powergate: `* layered virtual supplies: header -> VIRT_PWR -> header -> VIRT_PWR2, footer -> VIRT_GND
.GLOBAL VDD VSS
.SUBCKT INV A Z VPWR VGND
MP Z A VPWR VPWR pch W=0.2u L=0.03u
MN Z A VGND VGND nch W=0.1u L=0.03u
.ENDS
.SUBCKT HEADER SLEEP VIN VOUT
MSW VOUT SLEEP VIN VIN pch W=10u L=0.1u
.ENDS
.SUBCKT FOOTER SLEEPB VIN VOUT
MSW VOUT SLEEPB VIN VIN nch W=10u L=0.1u
.ENDS
* hierarchical: virtual rails are recognised because INV uses them on its VPWR/VGND ports
.SUBCKT DOMAIN A Z SLEEP SLEEPB VDD VSS
XH1 SLEEP VDD VIRT_PWR / HEADER
XH2 SLEEP VIRT_PWR VIRT_PWR2 / HEADER
XF1 SLEEPB VSS VIRT_GND / FOOTER
XI1 A n1 VIRT_PWR VIRT_GND / INV
XI2 n1 Z VIRT_PWR2 VIRT_GND / INV
.ENDS
* flat: switches inside the cell, so VVDD/VVVDD are wires here and VDD is the only stub
.SUBCKT GATED_INV A Z SLEEP VDD VSS
MSW1 VVDD SLEEP VDD VDD pch W=2u L=0.1u
MSW2 VVVDD SLEEP VVDD VVDD pch W=2u L=0.1u
MP Z A VVVDD VVVDD pch W=0.2u L=0.03u
MN Z A VSS VSS nch W=0.1u L=0.03u
.ENDS
.SUBCKT TOP A Z SLEEP SLEEPB VDD VSS
XD A n SLEEP SLEEPB VDD VSS / DOMAIN
XG n Z SLEEP VDD VSS / GATED_INV
.ENDS
* non-standard supply names: type VCORE into Power and VSUB into Ground to get stubs
.SUBCKT ODDPWR A Z VCORE VSUB
MP Z A VCORE VCORE pch W=0.2u L=0.03u
MN Z A VSUB VSUB nch W=0.1u L=0.03u
.ENDS
`,
};
if (typeof module !== 'undefined') module.exports = EXAMPLES;

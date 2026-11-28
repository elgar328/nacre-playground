const e=`let s1 = sketch(XY)
  .rect([-45, -25], [45, 25], {fillet: 5})
  .circle({center: [38, 18], d: 7})
  .circle({center: [38, -18], d: 7})
  .circle({center: [-38, 18], d: 7})
  .circle({center: [-38, -18], d: 7});
let p1 = extrude(s1, 12);

let s2 = sketch(ZX)
  .moveTo([12, 0])
  .lineTo([12, 7.5])
  .lineTo([27, 7.5])
  .lineTo([27, 5.5])
  .lineTo([62, 5.5])
  .lineTo([62, -5.5])
  .lineTo([27, -5.5])
  .lineTo([27, -7.5])
  .lineTo([12, -7.5])
  .close()
let p2 = extrude(s2, [-20, 20]).translate([17.5, 0, 0]);
let p3 = extrude(s2, [-20, 20]).translate([-17.5, 0, 0]);

let p4 = cylinder({center: [0,0,47], d: 20, h: 90, axis: X});

let part = cut(fuse(p1, p2, p3), p4);
`;export{e as default};

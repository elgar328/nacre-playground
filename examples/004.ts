let s1 = sketch(XY)
  .moveTo([-55,0])
  .lineTo([-55, -45], {fillet: 12})
  .lineTo([55, -45], {fillet: 12})
  .lineTo([55, 0])
  .close()
  .circle({center: [-43, -33], d: 12})
  .circle({center: [43, -33], d: 12});
let p1 = extrude(s1, 12);

let s2 = sketch(ZX)
  .moveTo([0, -55])
  .lineTo([0, 55])
  .lineTo([62, 55], {fillet: 12})
  .lineTo([62, -55], {fillet: 12})
  .close()
  .circle({center: [50, 43], d: 12})
  .circle({center: [50, -43], d: 12});
let p2 = extrude(s2, -12);

let s3 = sketch(ZX)
  .moveTo([12, -11])
  .lineTo([12, 11])
  .lineTo([52, 20])
  .lineTo([52, 25])
  .lineTo([62, 25])
  .lineTo([62, 15])
  .lineTo([62, -25])
  .lineTo([52, -25])
  .lineTo([52, -20])
  .close();
let p3 = extrude(s3, -35);

let c1 = cuboid({size: [60, 100, 12]});
let c2 = cylinder({center: [0, 0, 62], d: 30, h: 100, axis: Y});

let part = cut(fuse(p1, p2, p3), c1, c2);

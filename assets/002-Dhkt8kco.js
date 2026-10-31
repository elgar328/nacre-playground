const e=`let s1 = sketch(XY)
  .moveTo([-3.5,-4])
  .lineTo([3.5,-4], {fillet: 2})
  .lineTo([3.5,4])
  .lineTo([-3.5,4])
  .close({fillet: 2})
  .circle({center: [-1.5, -2], d:2})
  .circle({center: [1.5, -2], d:2});
let p1 = extrude(s1, 1);

let s2 = sketch(ZX)
  .rect([1, -3.5], [6, 3.5])
  .rect([2.5, -0.5], [4.5, 0.5], {fillet: 0.5});
let p2 = extrude(s2, [3, 4]);

let s3 = sketch(YZ)
  .moveTo([0, 1])
  .lineTo([3, 1])
  .lineTo([3, 6])
  .close()
let p3 = extrude(s3, [1.5, 2.5]);
let p4 = extrude(s3, [-2.5, -1.5]);

let part = fuse(p1, p2, p3, p4);
`;export{e as default};

const e=`let p1 = cuboid({size: [40, 46, 46]});

let p2 = cylinder({d: 30, h: 66});
let c2 = cylinder({d: 15, h: 100});

let p3 = cylinder({d: 36, h: 84, axis: X});
let c3 = cylinder({d: 18, h: 100, axis: X});

let c4 = cuboid({size: [24, 100, 30]});

let part = cut(fuse(p1, p2, p3), c4, c2, c3);
`;export{e as default};

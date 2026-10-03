const n=`let s1 = sketch(XY)
  .rect([-15, -25], [15, 25])
  .circle({center: [0,0], d: 10});
let p1 = extrude(s1, 10).translate([0,0,50]);

let s2 = sketch(ZX)
  .moveTo([60, 15])
  .lineTo([0, 15])
  .lineTo([0, 85])
  .lineTo([10, 85])
  .lineTo([10, 25])
  .lineTo([60, 25])
  .close();
let p2 = extrude(s2, [-25, 25]);

let p3 = cuboid({size: [25, 25, 50], corner: [25, 0, 10]});
let p4 = cuboid({size: [200, 20, 10]});

let part = cut(fuse(p1, p2, p3), p4);

style({opacity: 0.5,
       edges: {color: "#FFA500"}
      });

view({projection: "perspective",
      from: [60, -80, 80],
      at: [30, 0, 20],
      fov: 60,
      zoom: 1.2
     });
`;export{n as default};

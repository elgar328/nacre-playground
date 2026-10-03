// Turn a 2×2×2 cube 45° about Z: its corner (1, 1, 1) lands at (0, √2, 1).
// The kernel computes coordinates exactly, to any precision you ask for.
let box = cuboid({ size: [2, 2, 2], center: [0, 0, 0] }).rotateZ(45);
let corner = box.vertices().nearest([0, 1.5, 1]);

let [x, y, z] = corner.digits(50).slice(1, -1).split(", ");
print("x =", x); // 0
print("y =", y); // √2
print("z =", z); // 1

view({ from: [1, -3, 1.5] });
display(box, { opacity: 0.35 });

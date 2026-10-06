import { BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape } from 'three';

/** Inches; Three.js uses Y up. The pallet's geometric center is the origin. */
export function createPallet(): Group {
  const pallet = new Group();
  const wood = new MeshStandardMaterial({ color: 0xc79c64, roughness: 0.88 });
  // Directional grain and knots in each board's local coordinates, without external assets.
  wood.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vWoodPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodPosition = position;');
    shader.fragmentShader = 'varying vec3 vWoodPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float knot = length(vec2(vWoodPosition.x * 2.0, vWoodPosition.z * 0.16));
      float grain = sin(vWoodPosition.x * 42.0 + sin(vWoodPosition.z * 0.3) * 2.0 + sin(knot) * 3.0);
      float fineGrain = sin(vWoodPosition.x * 160.0 + vWoodPosition.z * 0.8);
      diffuseColor.rgb *= 0.88 + 0.09 * grain + 0.03 * fineGrain;
    `);
  };
  const nailMaterial = new MeshStandardMaterial({ color: 0x91979c, metalness: 0.8, roughness: 0.4 });
  const nailGeometry = new CylinderGeometry(0.11, 0.11, 0.03125, 8);
  const profile = new Shape();
  // A continuous runner with two open-bottom, 9 × 1.25 inch fork notches.
  profile.moveTo(-24, -1.75);
  for (const [x, y] of [
    [-18, -1.75], [-18, -0.5], [-9, -0.5], [-9, -1.75],
    [9, -1.75], [9, -0.5], [18, -0.5], [18, -1.75],
    [24, -1.75], [24, 1.75], [-24, 1.75],
  ]) profile.lineTo(x, y);
  profile.closePath();
  const stringerGeometry = new ExtrudeGeometry(profile, { depth: 1.25, bevelEnabled: false, steps: 1 });
  stringerGeometry.translate(0, 0, -0.625);
  const stringerOffsets = [-19.375, 0, 19.375];
  for (const z of stringerOffsets) {
    const stringer = new Mesh(stringerGeometry, wood);
    stringer.name = 'stringer';
    stringer.position.z = z;
    pallet.add(stringer);
  }
  for (const [name, interiorCount, y] of [
    ['top-deckboard', 5, 2.0625], ['bottom-deckboard', 3, -2.0625],
  ] as const) {
    const widths = [5.5, ...Array<number>(interiorCount).fill(3.5), 5.5];
    const gap = (48 - 11 - interiorCount * 3.5) / (interiorCount + 1);
    let edge = -24;
    for (const width of widths) {
      const board = new Mesh(new BoxGeometry(width, 0.625, 40), wood);
      board.name = name;
      board.position.set(edge + width / 2, y, 0);
      pallet.add(board);
      for (const z of stringerOffsets) {
        for (const offset of [-0.7, 0.7]) {
          const nail = new Mesh(nailGeometry, nailMaterial);
          nail.name = 'fastener';
          // Flush with the exposed deck surface; keep the exact pallet envelope.
          nail.position.set(board.position.x + offset, y + Math.sign(y) * 0.296875, z);
          pallet.add(nail);
        }
      }
      edge += width + gap;
    }
  }
  pallet.traverse(object => { object.castShadow = true; object.receiveShadow = true; });
  return pallet;
}

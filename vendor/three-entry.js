/* three-entry.js: the part of Three.js the film uses, re-exported so esbuild can tree-shake the rest out of three.min.js.
   Add a class here when a scene needs one, then rebuild (see build_three.js).
   Author:  Muhammad Akhtar Shamim
   Licence: MIT (see LICENSE)
   Created: 2026-11-21 */
export {
  Scene, PerspectiveCamera, WebGLRenderer, Color, Fog, FogExp2, Clock, Group, Object3D,
  Vector2, Vector3, Matrix4, Quaternion, Euler, MathUtils,
  BoxGeometry, PlaneGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, RingGeometry,
  IcosahedronGeometry, OctahedronGeometry, CapsuleGeometry, BufferGeometry, Float32BufferAttribute,
  CatmullRomCurve3, TubeGeometry, Shape, ExtrudeGeometry, EdgesGeometry,
  MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial, PointsMaterial, SpriteMaterial, ShaderMaterial,
  Mesh, InstancedMesh, Points, Line, LineSegments, LineLoop, Sprite,
  AmbientLight, HemisphereLight, DirectionalLight, PointLight, SpotLight,
  CanvasTexture, SRGBColorSpace, AdditiveBlending, NormalBlending, DoubleSide, FrontSide, ACESFilmicToneMapping, DynamicDrawUsage, LinearFilter
} from "three";

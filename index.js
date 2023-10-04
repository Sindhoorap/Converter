import * as THREE from "three";
import { readFileSync, writeFileSync } from "fs";
import { IfcAPI } from "web-ifc";
import { GLTFExporter } from "./GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

console.log("Hello web-ifc-node!");

const ifcAPI = new IfcAPI();
// const fs = require('fs')
async function LoadFile(filename) {
  // load model data as a string
  const data = readFileSync(filename); // Read IFC file as a string
  await ifcAPI.Init();
  let modelID = ifcAPI.OpenModel(data);

  let geometries = [];
  let transparentGeometries = [];

  ifcAPI.StreamAllMeshes(modelID, (mesh) => {
    // only during the lifetime of this function call, the geometry is available in memory
    const placedGeometries = mesh.geometries;

    for (let i = 0; i < placedGeometries.size(); i++) {
      const placedGeometry = placedGeometries.get(i);
      let mesh = getPlacedGeometry(modelID, placedGeometry);
      let geom = mesh.geometry.applyMatrix4(mesh.matrix);
      if (placedGeometry.color.w !== 1) {
        transparentGeometries.push(geom);
      } else {
        geometries.push(geom);
      }
    }
  });

  console.log(
    "Loading " +
      geometries.length +
      " geometries and " +
      transparentGeometries.length +
      " transparent geometries"
  );

  // Combine geometries from both arrays
  const combinedGeometries = [...geometries, ...transparentGeometries];
  if (combinedGeometries.length > 0) {
    const combinedGeometry = mergeGeometries(combinedGeometries);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    mat.vertexColors = true;
    const mergedMesh = new THREE.Mesh(combinedGeometry, mat);

    const scene = new THREE.Scene();
    scene.add(mergedMesh);

    const exporter = new GLTFExporter();

    exporter.parse(
      scene, //doesn't run in node environment because FileReader() is used in GLTFExporter
      function (gltf) {
        writeFileSync("output.gltf", JSON.stringify(gltf, null, 2), "utf-8");
        console.log("GLTF data written to output.gltf");
      },
      function (error) {
        console.log("An error happened during export:", error);
      }
    );
  }
}

function getPlacedGeometry(modelID, placedGeometry) {
  const geometry = getBufferGeometry(modelID, placedGeometry);
  const material = getMeshMaterial(placedGeometry.color);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrix = getMeshMatrix(placedGeometry.flatTransformation);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function getBufferGeometry(modelID, placedGeometry) {
  // WARNING: geometry must be deleted when requested from WASM
  const geometry = ifcAPI.GetGeometry(
    modelID,
    placedGeometry.geometryExpressID
  );
  const verts = ifcAPI.GetVertexArray(
    geometry.GetVertexData(),
    geometry.GetVertexDataSize()
  );
  const indices = ifcAPI.GetIndexArray(
    geometry.GetIndexData(),
    geometry.GetIndexDataSize()
  );
  const bufferGeometry = ifcGeometryToBuffer(
    placedGeometry.color,
    verts,
    indices
  );

  //@ts-ignore
  geometry.delete();
  return bufferGeometry;
}

var materials = {};

function getMeshMaterial(color) {
  let colID = `${color.x}${color.y}${color.z}${color.w}`;
  if (materials[colID]) {
    return materials[colID];
  }

  const col = new THREE.Color(color.x, color.y, color.z);
  const material = new THREE.MeshStandardMaterial({
    color: col,
    side: THREE.DoubleSide,
  });
  material.transparent = color.w !== 1;
  if (material.transparent) material.opacity = color.w;

  materials[colID] = material;

  return material;
}

function getMeshMatrix(matrix) {
  const mat = new THREE.Matrix4();
  mat.fromArray(matrix);
  return mat;
}

function ifcGeometryToBuffer(color, vertexData, indexData) {
  const geometry = new THREE.BufferGeometry();
  let posFloats = new Float32Array(vertexData.length / 2);
  let normFloats = new Float32Array(vertexData.length / 2);
  let colorFloats = new Float32Array(vertexData.length / 2);

  for (let i = 0; i < vertexData.length; i += 6) {
    posFloats[i / 2 + 0] = vertexData[i + 0];
    posFloats[i / 2 + 1] = vertexData[i + 1];
    posFloats[i / 2 + 2] = vertexData[i + 2];

    normFloats[i / 2 + 0] = vertexData[i + 3];
    normFloats[i / 2 + 1] = vertexData[i + 4];
    normFloats[i / 2 + 2] = vertexData[i + 5];

    colorFloats[i / 2 + 0] = color.x;
    colorFloats[i / 2 + 1] = color.y;
    colorFloats[i / 2 + 2] = color.z;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(posFloats, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normFloats, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colorFloats, 3));
  geometry.setIndex(new THREE.BufferAttribute(indexData, 1));
  return geometry;
}

// Call the LoadFile function with the IFC file path
LoadFile("./example.ifc");

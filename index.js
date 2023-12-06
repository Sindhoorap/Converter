import * as THREE from "three";
import { readFileSync, readdirSync, mkdirSync } from "fs";
import { IfcAPI } from "web-ifc";
import { Blob, FileReader } from "vblob";
global.Blob = Blob;
global.FileReader = FileReader;
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import pkgFS from "fs-extra";
const { readJSONSync, writeFileSync, writeJSONSync, statSync } = pkgFS;
import pkgGLTF from "gltf-pipeline";
const { gltfToGlb, processGltf } = pkgGLTF;
console.log("Hello web-ifc-node!");

const ifcAPI = new IfcAPI();

async function LoadFile(filename) {
  // load model data as a string
  const data = readFileSync(`./ifcfiles/${filename}`); // Read IFC file as a string
  await ifcAPI.Init();
  let modelID = ifcAPI.OpenModel(data);

  let geometries = [];
  let transparentGeometries = [];

  await new Promise((resolve) => {
    ifcAPI.StreamAllMeshes(modelID, (mesh) => {
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
      resolve();
    });
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

    await new Promise((resolve, reject) => {
      exporter.parse(
        scene,
        (gltf) => {
          const outputFolder = "./output/gltfFiles";
          mkdirSync(outputFolder, { recursive: true });
          const file = filename.replace(".ifc", ".gltf");
          const outputFilename = `${outputFolder}/${file}`;

          writeFileSync(outputFilename, JSON.stringify(gltf, null, 2), "utf-8");
          console.log(`GLTF data written to ${outputFilename}`);
          resolve();
        },
        (error) => {
          console.log("An error happened during export:", error);
          reject(error);
        }
      );
    });
  }
  return combinedGeometries.length;
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

async function convert(fileName) {
  try {
    console.log("inside converter");
    const file = fileName.replace(".ifc", ".gltf");
    const gltf = readJSONSync(`./output/gltfFiles/${file}`);
    const glbOptions = {};
    const options = {
      dracoOptions: {
        compressionLevel: 10,
      },
    };

    const startTimeGlb = new Date();
    const glbResult = await gltfToGlb(gltf, glbOptions);
    const endTimeGlb = new Date();

    const startTimeDraco = new Date();
    const gltf2 = readJSONSync(`./output/gltfFiles/${file}`);
    const dracoResult = await processGltf(gltf2, options);
    const endTimeDraco = new Date();

    const file1 = fileName.replace(".ifc", "");
    const outputFolderGlb = "./output/glbFiles";
    mkdirSync(outputFolderGlb, { recursive: true });
    const outputFolderDraco = "./output/dracoGltfFiles";
    mkdirSync(outputFolderDraco, { recursive: true });
    writeFileSync(`./output/glbFiles/${file1}.glb`, glbResult.glb);
    writeJSONSync(
      `./output/dracoGltfFiles/${file1}-draco.gltf`,
      dracoResult.gltf
    );

    return {
      glbConversionTime: endTimeGlb - startTimeGlb,
      dracoConversionTime: endTimeDraco - startTimeDraco
    };
  } catch (error) {
    console.error("An error occurred during conversion:", error);
    return {
      glbConversionTime: 0,
      dracoConversionTime: 0
    };
  }
}

let totalConversionTime = 0;

function getFileSizeInMB(filename) {
  const stats = statSync(filename);
  const fileSizeInBytes = stats.size;
  return (fileSizeInBytes / (1024 * 1024)).toFixed(2); // Convert bytes to MB and round to 2 decimal places
}

async function processAllIfcFilesInDirectory(directory) {
  const files = readdirSync(directory);
  for (const file of files) {
    if (file.endsWith(".ifc")) {
      try {
        const startTimeIfc = new Date();
        const combinedGeometriesLength = await LoadFile(file);
        const endTimeIfc = new Date();

        const conversionTimes = await convert(file);

        const gltfFilePath = `./output/gltfFiles/${file.replace(".ifc", ".gltf")}`;
        const glbFilePath = `./output/glbFiles/${file.replace(".ifc", ".glb")}`;
        const dracoFilePath = `./output/dracoGltfFiles/${file.replace(".ifc", "-draco.gltf")}`;

        const conversionInfo = {
          filename: file,
          ifcToGltfTime: endTimeIfc - startTimeIfc,
          gltfToGlbTime: conversionTimes.glbConversionTime,
          gltfToDracoGltfTime: conversionTimes.dracoConversionTime,
          combinedGeometries: combinedGeometriesLength,
          fileSizeMB: {
            ifc: getFileSizeInMB(`${directory}/${file}`),
            gltf: getFileSizeInMB(gltfFilePath),
            glb: getFileSizeInMB(glbFilePath),
            dracoGltf: getFileSizeInMB(dracoFilePath)
          }
        };
        mkdirSync("./output/conversionTimes/", { recursive: true });
        writeJSONSync(
          `./output/conversionTimes/${file}-time.json`,
          conversionInfo
        );
      } catch (error) {
        console.error(`Error processing file ${file}:`, error);
      }
    }
  }
}

const ifcFilesDirectory = "./ifcfiles";
processAllIfcFilesInDirectory(ifcFilesDirectory);
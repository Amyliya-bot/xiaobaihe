import {
  importGltfWithResources,
  type GltfExternalResources,
  type ModelReport
} from './import-export/model-io'

interface ValidationResource {
  name: string
  base64: string
  mimeType?: string
}

interface DracoValidationInput {
  source: string
  resources: ValidationResource[]
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

declare global {
  interface Window {
    runDracoPackageValidation: (input: DracoValidationInput) => Promise<ModelReport>
  }
}

window.runDracoPackageValidation = async ({
  source,
  resources
}: DracoValidationInput): Promise<ModelReport> => {
  const resourceMap = new Map(
    resources.map((resource) => [
      resource.name,
      { data: decodeBase64(resource.base64), mimeType: resource.mimeType }
    ])
  ) as GltfExternalResources
  const imported = await importGltfWithResources(source, resourceMap)
  return imported.report
}

document.documentElement.dataset.validationReady = 'true'

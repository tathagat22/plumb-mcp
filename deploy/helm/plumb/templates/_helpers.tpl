{{/*
Name helpers. Standard Helm shapes — kept here so every template agrees on what
an object is called, and so `fullnameOverride` actually works everywhere.
*/}}

{{- define "plumb.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "plumb.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "plumb.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "plumb.labels" -}}
helm.sh/chart: {{ include "plumb.chart" . }}
{{ include "plumb.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: plumb
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "plumb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "plumb.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "plumb.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "plumb.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Image references. `tag` falls back to the chart's appVersion so a chart upgrade
carries the app version with it instead of silently pinning an old one.
*/}}
{{- define "plumb.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "plumb.verifyImage" -}}
{{- $tag := default .Chart.AppVersion .Values.verify.image.tag -}}
{{- printf "%s:%s%s" .Values.verify.image.repository $tag .Values.verify.image.suffix -}}
{{- end -}}

{{/*
The Secret holding FIGMA_TOKEN, whether the chart made it or the operator did.
*/}}
{{- define "plumb.figmaSecretName" -}}
{{- if .Values.figma.existingSecret -}}
{{- .Values.figma.existingSecret -}}
{{- else -}}
{{- printf "%s-figma" (include "plumb.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "plumb.figmaSecretKey" -}}
{{- default "FIGMA_TOKEN" .Values.figma.existingSecretKey -}}
{{- end -}}

{{- define "plumb.assetSecretName" -}}
{{- if .Values.assetProviders.existingSecret -}}
{{- .Values.assetProviders.existingSecret -}}
{{- else -}}
{{- printf "%s-assets" (include "plumb.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "plumb.hasFigmaSecret" -}}
{{- if or .Values.figma.existingSecret .Values.figma.token -}}true{{- end -}}
{{- end -}}

{{- define "plumb.createsAssetSecret" -}}
{{- if and (not .Values.assetProviders.existingSecret) (or .Values.assetProviders.unsplashAccessKey .Values.assetProviders.pexelsApiKey .Values.assetProviders.pixabayApiKey .Values.assetProviders.googleFontsApiKey) -}}true{{- end -}}
{{- end -}}

{{- define "plumb.hasAssetSecret" -}}
{{- if or .Values.assetProviders.existingSecret (include "plumb.createsAssetSecret" .) -}}true{{- end -}}
{{- end -}}

{{/*
Environment shared by the bridge and the verify job: where Plumb writes, and
how it logs. Both run with a read-only root filesystem, so every writable path
here is backed by a volume.
*/}}
{{- define "plumb.commonEnv" -}}
- name: PLUMB_ASSETS_DIR
  value: /data/assets
- name: PLUMB_SCREENSHOTS_DIR
  value: /data/screenshots
- name: PLUMB_CACHE_DIR
  value: /data/cache
- name: PLUMB_LOG_LEVEL
  value: {{ .Values.bridge.logLevel | quote }}
- name: PLUMB_LOG_FORMAT
  value: {{ .Values.bridge.logFormat | quote }}
{{- if include "plumb.hasFigmaSecret" . }}
- name: FIGMA_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ include "plumb.figmaSecretName" . }}
      key: {{ include "plumb.figmaSecretKey" . }}
{{- end }}
{{- if include "plumb.hasAssetSecret" . }}
{{- range $name := list "UNSPLASH_ACCESS_KEY" "PEXELS_API_KEY" "PIXABAY_API_KEY" "GOOGLE_FONTS_API_KEY" }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ include "plumb.assetSecretName" $ }}
      key: {{ $name }}
      optional: true
{{- end }}
{{- end }}
{{- end -}}

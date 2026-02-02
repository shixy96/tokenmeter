import type { TestProviderResult } from '@/lib/api'
import type { ApiProvider } from '@/types'
import { Check, Play, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  useDeleteProvider,
  useProviders,
  useSaveProvider,
  useTestProvider,
} from '@/hooks/useProviders'

const TEMP_KEY_PREFIX = 'KEY_'

interface EnvEditorProps {
  env: Record<string, string>
  onChange: (env: Record<string, string>) => void
}

function EnvEditor({ env, onChange }: EnvEditorProps) {
  const [tempKeys, setTempKeys] = useState<Set<string>>(() => new Set())
  const entries = Object.entries(env)

  const removeTempKey = (key: string) => {
    setTempKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const handleAdd = () => {
    const newKey = `${TEMP_KEY_PREFIX}${Date.now()}`
    setTempKeys(prev => new Set([...prev, newKey]))
    onChange({ ...env, [newKey]: '' })
  }

  const handleRemove = (key: string) => {
    const newEnv = { ...env }
    delete newEnv[key]
    removeTempKey(key)
    onChange(newEnv)
  }

  const handleKeyChange = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || newKey in env) {
      return
    }
    const newEnv = { ...env }
    const value = newEnv[oldKey]
    delete newEnv[oldKey]
    newEnv[newKey] = value

    if (tempKeys.has(oldKey)) {
      removeTempKey(oldKey)
    }
    onChange(newEnv)
  }

  const handleValueChange = (key: string, value: string) => {
    onChange({ ...env, [key]: value })
  }

  const hasTempKeys = tempKeys.size > 0

  return (
    <div className="space-y-2">
      {entries.map(([key, value], index) => {
        const isTempKey = tempKeys.has(key)
        return (
          <div key={key || `empty-${index}`} className="flex gap-2 items-center">
            <Input
              placeholder="KEY"
              value={isTempKey ? '' : key}
              onChange={e => handleKeyChange(key, e.target.value)}
              className={`font-mono text-sm flex-1 ${isTempKey ? 'border-yellow-500' : ''}`}
            />
            <span className="text-muted-foreground">=</span>
            <Input
              placeholder="value"
              value={value}
              onChange={e => handleValueChange(key, e.target.value)}
              className="font-mono text-sm flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRemove(key)}
              className="shrink-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )
      })}
      {hasTempKeys && (
        <p className="text-xs text-yellow-600">
          Please enter a name for the highlighted environment variable(s)
        </p>
      )}
      <Button variant="outline" size="sm" onClick={handleAdd}>
        <Plus className="w-4 h-4 mr-1" />
        Add Variable
      </Button>
    </div>
  )
}

const defaultProvider: ApiProvider = {
  id: '',
  name: '',
  enabled: true,
  fetchScript: '',
  transformScript: '',
  env: {},
}

export function ProviderEditor() {
  const { data: providers = [], isLoading } = useProviders()
  const saveMutation = useSaveProvider()
  const deleteMutation = useDeleteProvider()
  const testMutation = useTestProvider()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null)
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null)

  const handleNew = () => {
    const newProvider: ApiProvider = {
      ...defaultProvider,
      id: `provider-${Date.now()}`,
      name: 'New Provider',
    }
    setEditingProvider(newProvider)
    setSelectedId(null)
    setTestResult(null)
  }

  const handleSelect = (provider: ApiProvider) => {
    setEditingProvider(structuredClone(provider))
    setSelectedId(provider.id)
    setTestResult(null)
  }

  const handleSave = () => {
    if (!editingProvider)
      return
    // Validate no temp keys in env
    const hasTempKeys = Object.keys(editingProvider.env).some(k => k.startsWith(TEMP_KEY_PREFIX))
    if (hasTempKeys) {
      return
    }
    saveMutation.mutate(editingProvider, {
      onSuccess: () => {
        setSelectedId(editingProvider.id)
      },
    })
  }

  const handleDelete = () => {
    if (!selectedId)
      return
    deleteMutation.mutate(selectedId, {
      onSuccess: () => {
        setEditingProvider(null)
        setSelectedId(null)
      },
    })
  }

  const handleTest = () => {
    if (!editingProvider)
      return
    setTestResult(null)
    testMutation.mutate(editingProvider, {
      onSuccess: (result) => {
        setTestResult(result)
      },
    })
  }

  const updateProvider = (updates: Partial<ApiProvider>) => {
    if (!editingProvider)
      return
    setEditingProvider({ ...editingProvider, ...updates })
  }

  if (isLoading) {
    return <div className="p-6">Loading providers...</div>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">API Providers</h1>
        <Button onClick={handleNew}>
          <Plus className="w-4 h-4 mr-2" />
          Add Provider
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[250px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Providers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {providers.map(provider => (
              <button
                key={provider.id}
                onClick={() => handleSelect(provider)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedId === provider.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{provider.name}</span>
                  {provider.enabled
                    ? <Check className="w-3 h-3" />
                    : <X className="w-3 h-3 opacity-50" />}
                </div>
              </button>
            ))}
            {providers.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No providers configured
              </p>
            )}
          </CardContent>
        </Card>

        {editingProvider && (
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedId ? 'Edit Provider' : 'New Provider'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={editingProvider.name}
                    onChange={e => updateProvider({ name: e.target.value })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>Enabled</Label>
                  <Switch
                    checked={editingProvider.enabled}
                    onCheckedChange={checked =>
                      updateProvider({ enabled: checked })}
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="fetchScript">Fetch Script (curl command)</Label>
                <Textarea
                  id="fetchScript"
                  value={editingProvider.fetchScript}
                  onChange={e => updateProvider({ fetchScript: e.target.value })}
                  // eslint-disable-next-line no-template-curly-in-string
                  placeholder="curl -s -H 'Authorization: Bearer ${TOKEN}' https://api.example.com/usage"
                  className="font-mono text-sm"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Use $&#123;VAR&#125; syntax to reference environment variables defined below.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transformScript">
                  Transform Script (JavaScript)
                </Label>
                <Textarea
                  id="transformScript"
                  value={editingProvider.transformScript}
                  onChange={e =>
                    updateProvider({ transformScript: e.target.value })}
                  placeholder="(response) => ({ cost: response.total_cost, tokens: response.total_tokens })"
                  className="font-mono text-sm"
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label>Environment Variables</Label>
                <EnvEditor
                  env={editingProvider.env}
                  onChange={env => updateProvider({ env })}
                />
              </div>

              <Separator />

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={testMutation.isPending}
                >
                  <Play className="w-4 h-4 mr-2" />
                  {testMutation.isPending ? 'Testing...' : 'Test'}
                </Button>
                {selectedId && (
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                )}
              </div>

              {testResult && (
                <div
                  className={`p-4 rounded-md ${
                    testResult.success
                      ? 'bg-green-50 dark:bg-green-950'
                      : 'bg-red-50 dark:bg-red-950'
                  }`}
                >
                  <p
                    className={`font-medium ${
                      testResult.success ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {testResult.success ? 'Test Passed' : 'Test Failed'}
                  </p>
                  {testResult.error && (
                    <p className="text-sm text-red-600 mt-1">{testResult.error}</p>
                  )}
                  {testResult.data && (
                    <pre className="text-xs mt-2 overflow-auto max-h-40">
                      {JSON.stringify(testResult.data, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

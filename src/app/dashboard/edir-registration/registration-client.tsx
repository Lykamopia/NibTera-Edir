'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { submitEdirRegistration, getEdirRegistrations, type EdirRegistrationInput } from '@/app/actions/edir-registration';
import { getBranches } from '@/app/actions/branches';
import { type Actor } from '@/lib/tenant-scope';
import { AlertCircle, Check, Clock, X } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  code: string;
  districtId: string;
  districtName: string;
}

interface Registration {
  id: string;
  name: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  branchId: string;
  branchName: string;
  contactPersonName: string | null;
  createdAt: Date;
  approvalStatus: string | null;
}

const FORM_STEPS = [
  { id: 'details', label: 'Edir Details' },
  { id: 'location', label: 'Branch/Location' },
  { id: 'contact', label: 'Contact Person' },
  { id: 'documents', label: 'Agreement' },
  { id: 'review', label: 'Review & Submit' },
];

export default function RegistrationClient({ actor }: { actor: Actor }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'ACTIVE' | 'REJECTED' | 'RETURNED' | 'ALL'>('PENDING');

  const [formData, setFormData] = useState<EdirRegistrationInput>({
    name: '',
    description: '',
    address: '',
    accountNumber: '',
    branchId: actor.branchId || '',
    contactPersonName: '',
    contactAddress: '',
    contactMobile: '',
    contactEmail: '',
    agreementDocUrl: '',
  });

  // Load branches
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const result = await getBranches(actor.districtId);
        if (result.success) {
          setBranches(result.data);
          // Pre-select branch for branch users
          if (actor.orgScope === 'BRANCH' && actor.branchId) {
            setFormData(prev => ({ ...prev, branchId: actor.branchId || '' }));
          }
        }
      } catch (err) {
        console.error('Failed to load branches:', err);
      }
    };
    loadBranches();
  }, [actor.branchId, actor.districtId, actor.orgScope]);

  // Load registrations
  useEffect(() => {
    const loadRegistrations = async () => {
      try {
        const result = await getEdirRegistrations({ status: statusFilter !== 'ALL' ? statusFilter : undefined });
        if (result.success) {
          setRegistrations(result.data);
        }
      } catch (err) {
        console.error('Failed to load registrations:', err);
      }
    };
    loadRegistrations();
  }, [statusFilter]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // In a real implementation, upload to cloud storage and get URL
      // For now, just store the filename as a placeholder
      setFormData(prev => ({ ...prev, agreementDocUrl: file.name }));
    }
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      setLoading(true);

      if (!formData.name.trim()) {
        setError('Edir name is required');
        return;
      }
      if (!formData.branchId) {
        setError('Please select a branch');
        return;
      }

      const result = await submitEdirRegistration(formData);
      if (result.success) {
        setSuccess('Edir registration submitted successfully! It will be reviewed by the approver.');
        setFormData({
          name: '',
          description: '',
          address: '',
          accountNumber: '',
          branchId: actor.branchId || '',
          contactPersonName: '',
          contactAddress: '',
          contactMobile: '',
          contactEmail: '',
          agreementDocUrl: '',
        });
        setCurrentStep(0);
        // Reload registrations
        const regResult = await getEdirRegistrations({ status: statusFilter !== 'ALL' ? statusFilter : undefined });
        if (regResult.success) {
          setRegistrations(regResult.data);
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="outline" className="bg-yellow-50"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'ACTIVE':
        return <Badge variant="outline" className="bg-green-50"><Check className="w-3 h-3 mr-1" /> Active</Badge>;
      case 'REJECTED':
        return <Badge variant="outline" className="bg-red-50"><X className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const canSubmit = formData.name.trim() && formData.branchId;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Form Section */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Register New Edir</CardTitle>
            <CardDescription>Submit your Edir for approval in {actor.branchId ? '3' : '5'} steps</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {success && (
              <Alert className="mb-6 border-green-200 bg-green-50">
                <Check className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800">{success}</AlertDescription>
              </Alert>
            )}

            {/* Steps Navigation */}
            <div className="mb-8">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {FORM_STEPS.map((step, idx) => (
                  <button
                    key={step.id}
                    onClick={() => setCurrentStep(idx)}
                    className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-colors ${
                      currentStep === idx
                        ? 'bg-blue-600 text-white'
                        : currentStep > idx
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 0: Edir Details */}
            {currentStep === 0 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Edir Name *</label>
                  <Input
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    placeholder="e.g., Addis Ababa Community Edir"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <Textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    placeholder="Brief overview of the Edir"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Edir Address</label>
                  <Input
                    name="address"
                    value={formData.address}
                    onChange={handleInputChange}
                    placeholder="Street address or location"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Account Number</label>
                  <Input
                    name="accountNumber"
                    value={formData.accountNumber}
                    onChange={handleInputChange}
                    placeholder="Bank account number if applicable"
                  />
                </div>
              </div>
            )}

            {/* Step 1: Branch/Location */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Branch *</label>
                  <select
                    name="branchId"
                    value={formData.branchId}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={actor.orgScope === 'BRANCH'}
                  >
                    <option value="">Select a branch...</option>
                    {branches.map(branch => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name} ({branch.code}) - {branch.districtName}
                      </option>
                    ))}
                  </select>
                </div>
                {actor.orgScope === 'BRANCH' && (
                  <p className="text-sm text-gray-600">Your branch has been pre-selected.</p>
                )}
              </div>
            )}

            {/* Step 2: Contact Person */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Person Name</label>
                  <Input
                    name="contactPersonName"
                    value={formData.contactPersonName}
                    onChange={handleInputChange}
                    placeholder="Chairperson or primary contact"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Address</label>
                  <Input
                    name="contactAddress"
                    value={formData.contactAddress}
                    onChange={handleInputChange}
                    placeholder="Contact's address"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Mobile Number</label>
                  <Input
                    name="contactMobile"
                    value={formData.contactMobile}
                    onChange={handleInputChange}
                    placeholder="+251 9xx xxx xxxx"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email Address</label>
                  <Input
                    name="contactEmail"
                    value={formData.contactEmail}
                    onChange={handleInputChange}
                    placeholder="contact@edir.com"
                  />
                </div>
              </div>
            )}

            {/* Step 3: Agreement Document */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Agreement Document (PDF)</label>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="agreement-upload"
                    />
                    <label
                      htmlFor="agreement-upload"
                      className="cursor-pointer block"
                    >
                      <div className="text-gray-600">
                        {formData.agreementDocUrl ? (
                          <>
                            <Check className="w-8 h-8 mx-auto mb-2 text-green-600" />
                            <p className="font-medium text-green-700">{formData.agreementDocUrl}</p>
                            <p className="text-sm text-gray-500 mt-1">Click to change file</p>
                          </>
                        ) : (
                          <>
                            <p className="font-medium">Click to upload or drag and drop</p>
                            <p className="text-sm text-gray-500 mt-1">PDF files only, up to 10MB</p>
                          </>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Review & Submit */}
            {currentStep === 4 && (
              <div className="space-y-6">
                <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Edir Name</p>
                      <p className="font-medium">{formData.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600">Branch</p>
                      <p className="font-medium">{branches.find(b => b.id === formData.branchId)?.name}</p>
                    </div>
                    {formData.description && (
                      <div className="col-span-2">
                        <p className="text-sm text-gray-600">Description</p>
                        <p className="font-medium">{formData.description}</p>
                      </div>
                    )}
                    {formData.contactPersonName && (
                      <div className="col-span-2">
                        <p className="text-sm text-gray-600">Contact Person</p>
                        <p className="font-medium">{formData.contactPersonName}</p>
                      </div>
                    )}
                  </div>
                </div>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Your registration will be submitted for approval. The approver will review all details and contact information.
                  </AlertDescription>
                </Alert>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex gap-3 mt-8">
              <Button
                variant="outline"
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                disabled={currentStep === 0}
              >
                Previous
              </Button>
              {currentStep === FORM_STEPS.length - 1 ? (
                <Button
                  onClick={handleSubmit}
                  disabled={!canSubmit || loading}
                  className="flex-1"
                >
                  {loading ? 'Submitting...' : 'Submit Registration'}
                </Button>
              ) : (
                <Button
                  onClick={() => setCurrentStep(Math.min(FORM_STEPS.length - 1, currentStep + 1))}
                  className="flex-1"
                >
                  Next
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Registrations List Sidebar */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Registrations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex gap-2 mb-4">
                {['PENDING', 'ACTIVE', 'ALL'].map(status => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status as any)}
                    className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                      statusFilter === status
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="space-y-3 max-h-96 overflow-y-auto">
                {registrations.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No registrations yet</p>
                ) : (
                  registrations.map(reg => (
                    <div key={reg.id} className="border rounded-lg p-3 text-sm">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1">
                          <p className="font-medium line-clamp-1">{reg.name}</p>
                          <p className="text-xs text-gray-500">{reg.branchName}</p>
                        </div>
                        {getStatusBadge(reg.status)}
                      </div>
                      <p className="text-xs text-gray-600">
                        {new Date(reg.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

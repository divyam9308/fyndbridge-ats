import { FileText, Pencil, Plus, Upload, Eye } from 'lucide-react'
import '../styles/Shared.css'

const cvs = []

export default function CVsPage() {
  const handleUpload = () => {}
  const handleView = () => {}
  const handleEdit = () => {}

  return (
    <div>
      <div className="page-header cvs-page-header">
        <div>
          <div className="page-subtitle">Upload, review, and manage candidate CVs</div>
        </div>
        <button className="btn-primary" type="button" onClick={handleUpload} id="btn-upload-cvs">
          <Upload size={15} strokeWidth={2.5} /> Upload CVs
        </button>
      </div>

      <div className="table-card">
        {cvs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><FileText size={28} color="var(--gold)" strokeWidth={1.5} /></div>
            <div className="empty-state-title">No CVs uploaded yet</div>
            <button className="btn-primary" type="button" onClick={handleUpload}>
              <Plus size={15} strokeWidth={2.5} /> Upload CVs
            </button>
          </div>
        ) : (
          <table className="data-table" aria-label="CVs">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Candidate Name</th>
                <th>Phone Number</th>
                <th>Email</th>
                <th>Current Designation</th>
                <th>Current Organization</th>
                <th>Experience Years</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cvs.map((cv, index) => (
                <tr key={cv.id}>
                  <td>{index + 1}</td>
                  <td><div className="name-text">{cv.candidateName || '-'}</div></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{cv.phoneNumber || '-'}</td>
                  <td style={{ color: 'var(--info)', fontSize: 12.5 }}>{cv.email || '-'}</td>
                  <td>{cv.currentDesignation || '-'}</td>
                  <td>{cv.currentOrganization || '-'}</td>
                  <td>{cv.experienceYears ?? '-'}</td>
                  <td>
                    <div className="row-actions">
                      <button className="row-action-btn" type="button" title="View" onClick={handleView}>
                        <Eye size={13} strokeWidth={2} />
                      </button>
                      <button className="row-action-btn" type="button" title="Edit" onClick={handleEdit}>
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

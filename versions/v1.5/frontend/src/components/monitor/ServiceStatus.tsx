import { ServiceInfo } from './types';

interface ServiceStatusProps {
  services: ServiceInfo[];
  onRefresh?: () => void;
}

export function ServiceStatus({ services, onRefresh }: ServiceStatusProps) {
  const onlineCount = services.filter(s => s.status === 'online').length;
  const totalCount = services.length;

  return (
    <div className="monitor-card services">
      <div className="card-header">
        <span className="card-title">
          <span className="icon">🔌</span>
          Services Status
        </span>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          {onlineCount}/{totalCount} Online
        </div>
      </div>
      
      <div className="services-list">
        {services.map((service) => (
          <div key={service.name} className="service-item">
            <div className="service-info">
              <span className={`service-status ${service.status}`} />
              <span className="service-name">{service.name}</span>
              <span className="service-port">:{service.port}</span>
            </div>
            <div className="service-metrics">
              {service.responseTime && (
                <span className={`service-response ${service.responseTime > 500 ? 'slow' : ''}`}>
                  {service.responseTime}ms
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ServiceStatus;

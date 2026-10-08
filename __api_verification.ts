/**
 * Real API Verification Tests
 * Tests actual HTTP endpoints → backend → Prisma → PostgreSQL
 * NO MOCKS - verifies real database state changes
 */

const BASE_URL = 'http://localhost:5000/api/v1';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  role: string;
}

interface TestContext {
  admin?: AuthTokens;
  customer?: AuthTokens;
}

const context: TestContext = {};

// Test result tracking
const results: Array<{ phase: string; test: string; status: 'PASS' | 'FAIL' | 'SKIP'; details?: string }> = [];

function log(phase: string, test: string, status: 'PASS' | 'FAIL' | 'SKIP', details?: string) {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '○';
  console.log(`${icon} [${phase}] ${test}${details ? `: ${details}` : ''}`);
  results.push({ phase, test, status, details });
}

async function apiCall(endpoint: string, options: {
  method?: string;
  token?: string;
  body?: any;
} = {}) {
  const { method = 'GET', token, body } = options;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await response.json().catch(() => null);
    }
    
    return {
      status: response.status,
      data,
      ok: response.ok,
    };
  } catch (error) {
    return {
      status: 0,
      data: null,
      ok: false,
      error: String(error),
    };
  }
}

async function authenticateUsers() {
  console.log('\n=== Phase 5.1: Authentication Tests ===\n');

  try {
    // Test 1: Admin login
    const adminRes = await apiCall('/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@demo.logiflow.app',
        password: 'Demo@LogiFlow2026',
      },
    });

    if (adminRes.status === 200 && adminRes.data?.data?.accessToken) {
      context.admin = {
        accessToken: adminRes.data.data.accessToken,
        refreshToken: adminRes.data.data.refreshToken,
        userId: adminRes.data.data.user.id,
        role: adminRes.data.data.user.role,
      };
      log('5.1', 'Admin login', 'PASS', `userId: ${context.admin.userId}, role: ${context.admin.role}`);

      // Verify token works
      const profileRes = await apiCall('/users/me', { token: context.admin.accessToken });
      if (profileRes.status === 200) {
        log('5.1', 'Admin token verification', 'PASS');
      } else {
        log('5.1', 'Admin token verification', 'FAIL', `status ${profileRes.status}`);
      }
    } else {
      log('5.1', 'Admin login', 'FAIL', `status ${adminRes.status}, data: ${JSON.stringify(adminRes.data)}`);
    }

    // Test 2: Customer login
    const customerRes = await apiCall('/auth/login', {
      method: 'POST',
      body: {
        email: 'customer1@demo.logiflow.app',
        password: 'Demo@LogiFlow2026',
      },
    });

    if (customerRes.status === 200 && customerRes.data?.data?.accessToken) {
      context.customer = {
        accessToken: customerRes.data.data.accessToken,
        refreshToken: customerRes.data.data.refreshToken,
        userId: customerRes.data.data.user.id,
        role: customerRes.data.data.user.role,
      };
      log('5.1', 'Customer login', 'PASS', `userId: ${context.customer.userId}, role: ${context.customer.role}`);
    } else {
      log('5.1', 'Customer login', 'FAIL', `status ${customerRes.status}`);
    }

    // Test 3: Invalid credentials
    const invalidRes = await apiCall('/auth/login', {
      method: 'POST',
      body: {
        email: 'admin@demo.logiflow.app',
        password: 'wrongpassword',
      },
    });

    if (invalidRes.status === 401 || invalidRes.status === 400) {
      log('5.1', 'Invalid credentials rejection', 'PASS', `status ${invalidRes.status}`);
    } else {
      log('5.1', 'Invalid credentials rejection', 'FAIL', `expected 401/400, got ${invalidRes.status}`);
    }

  } catch (error) {
    log('5.1', 'Authentication phase', 'FAIL', String(error));
  }
}

async function testShipmentCRUD() {
  console.log('\n=== Phase 5.2: Shipment CRUD Tests ===\n');

  if (!context.customer) {
    log('5.2', 'Shipment tests', 'SKIP', 'No customer auth');
    return;
  }

  let shipmentId: string | null = null;

  try {
    // Test 1: Create shipment (match actual API schema)
    const createRes = await apiCall('/shipments', {
      method: 'POST',
      token: context.customer.accessToken,
      body: {
        senderName: 'Test Sender',
        senderPhone: '01712345678',
        senderAddress: '456 Origin Road, Dhaka',
        senderCity: 'Dhaka',
        originZoneId: 'cmtrd4f5a0011fmaokis67wvy', // ZONE-DHK-N from DB check
        recipientName: 'Jane Smith',
        recipientPhone: '01787654321',
        recipientAddress: '123 Test Street, Dhaka',
        recipientCity: 'Dhaka',
        destinationZoneId: 'cmupba8dr0006fm3kejd5864n', // ZN-DHK-S from DB check
        deliveryType: 'STANDARD',
        parcelType: 'REGULAR',
        declaredWeightKg: 2.5,
        description: 'API verification test shipment',
        items: [
          {
            description: 'Test Package',
            weightKg: 2.5,
            quantity: 1,
            parcelType: 'REGULAR',
          },
        ],
      },
    });

    if (createRes.status === 201 && createRes.data?.data?.id) {
      shipmentId = createRes.data.data.id;
      log('5.2', 'Create shipment via API', 'PASS', `shipmentId: ${shipmentId}, tracking: ${createRes.data.data.trackingNumber}`);
    } else {
      log('5.2', 'Create shipment via API', 'FAIL', `status ${createRes.status}, data: ${JSON.stringify(createRes.data)}`);
    }

    // Test 2: Get shipment
    if (shipmentId) {
      const getRes = await apiCall(`/shipments/${shipmentId}`, {
        token: context.customer.accessToken,
      });
      
      if (getRes.status === 200 && (getRes.data?.data?.id === shipmentId || getRes.data?.id === shipmentId)) {
        const tracking = getRes.data?.data?.trackingNumber || getRes.data?.trackingNumber;
        log('5.2', 'Get shipment by ID', 'PASS', `tracking: ${tracking}`);
      } else {
        log('5.2', 'Get shipment by ID', 'FAIL', `status ${getRes.status}`);
      }
    }

    // Test 3: List customer's shipments
    const listRes = await apiCall('/shipments', {
      token: context.customer.accessToken,
    });
    
    if (listRes.status === 200) {
      // API might return data.shipments or data.data
      const shipments = listRes.data?.data?.shipments || listRes.data?.shipments || listRes.data?.data || [];
      const found = Array.isArray(shipments) && shipments.some((s: any) => s.id === shipmentId);
      if (found || shipmentId === null) {
        log('5.2', 'List shipments', 'PASS', `total: ${Array.isArray(shipments) ? shipments.length : '?'}`);
      } else {
        log('5.2', 'List shipments includes new shipment', 'FAIL', 'Not in list');
      }
    } else {
      log('5.2', 'List shipments', 'FAIL', `status ${listRes.status}`);
    }

    // Test 4: Update shipment (only allowed fields for update)
    if (shipmentId && context.admin) {
      const updateRes = await apiCall(`/shipments/${shipmentId}`, {
        method: 'PATCH',
        token: context.admin.accessToken,
        body: {
          recipientName: 'Updated Recipient',
          specialInstructions: 'Handle with care',
        },
      });

      if (updateRes.status === 200) {
        log('5.2', 'Update shipment (admin)', 'PASS');

        // Verify the update by getting it again
        const verifyRes = await apiCall(`/shipments/${shipmentId}`, {
          token: context.admin.accessToken,
        });

        const recipientName = verifyRes.data?.data?.recipientName || verifyRes.data?.recipientName;
        if (recipientName === 'Updated Recipient') {
          log('5.2', 'Update persisted in DB', 'PASS');
        } else {
          log('5.2', 'Update persisted in DB', 'FAIL', `recipientName: ${recipientName}`);
        }
      } else {
        log('5.2', 'Update shipment', 'FAIL', `status ${updateRes.status}`);
      }
    }

    // Test 5: Get tracking/timeline
    if (shipmentId) {
      const trackingRes = await apiCall(`/shipments/${shipmentId}/tracking`, {
        token: context.customer.accessToken,
      });
      
      if (trackingRes.status === 200) {
        log('5.2', 'Get shipment tracking', 'PASS');
      } else if (trackingRes.status === 404) {
        log('5.2', 'Get shipment tracking', 'SKIP', 'No tracking data yet');
      } else {
        log('5.2', 'Get shipment tracking', 'FAIL', `status ${trackingRes.status}`);
      }
    }

  } catch (error) {
    log('5.2', 'Shipment CRUD phase', 'FAIL', String(error));
  }
}

async function testIDOR() {
  console.log('\n=== Phase 6: IDOR / Authorization Tests ===\n');

  if (!context.customer || !context.admin) {
    log('6', 'IDOR tests', 'SKIP', 'Missing auth contexts');
    return;
  }

  try {
    // Get customer's own shipments first
    const listRes = await apiCall('/shipments', {
      token: context.customer.accessToken,
    });

    const shipments = listRes.data?.data?.shipments || listRes.data?.shipments || listRes.data?.data || [];
    const customerShipmentId = (Array.isArray(shipments) && shipments[0]) ? shipments[0].id : null;

    if (!customerShipmentId) {
      log('6', 'IDOR tests', 'SKIP', 'No customer shipment found');
      return;
    }

    // Test 1: Customer can access their own shipment
    const ownRes = await apiCall(`/shipments/${customerShipmentId}`, {
      token: context.customer.accessToken,
    });

    if (ownRes.status === 200) {
      log('6', 'Customer access own shipment', 'PASS');
    } else {
      log('6', 'Customer access own shipment', 'FAIL', `status ${ownRes.status}`);
    }

    // Test 2: Admin can access any shipment
    const adminRes = await apiCall(`/shipments/${customerShipmentId}`, {
      token: context.admin.accessToken,
    });

    if (adminRes.status === 200) {
      log('6', 'Admin access any shipment', 'PASS');
    } else {
      log('6', 'Admin access any shipment', 'FAIL', `status ${adminRes.status}`);
    }

    // Test 3: Unauthenticated access should fail
    const noAuthRes = await apiCall(`/shipments/${customerShipmentId}`);

    if (noAuthRes.status === 401) {
      log('6', 'Unauthenticated access blocked', 'PASS');
    } else {
      log('6', 'Unauthenticated access blocked', 'FAIL', `status ${noAuthRes.status}`);
    }

    // Test 4: Try to find admin's shipments to test IDOR
    const adminListRes = await apiCall('/shipments', {
      token: context.admin.accessToken,
    });

    const adminShipments = adminListRes.data?.data?.shipments || adminListRes.data?.shipments || adminListRes.data?.data || [];
    // Find a shipment that doesn't belong to customer
    const adminShipment = Array.isArray(adminShipments) ? adminShipments.find((s: any) => 
      s.customerId !== context.customer?.userId
    ) : null;

    if (adminShipment) {
      const idorRes = await apiCall(`/shipments/${adminShipment.id}`, {
        token: context.customer.accessToken,
      });

      if (idorRes.status === 403 || idorRes.status === 404) {
        log('6', 'IDOR protection (customer cannot access other shipment)', 'PASS', `status ${idorRes.status}`);
      } else if (idorRes.status === 200) {
        log('6', 'IDOR protection', 'FAIL', 'Customer accessed another customer shipment!');
      } else {
        log('6', 'IDOR protection', 'FAIL', `unexpected status ${idorRes.status}`);
      }
    } else {
      log('6', 'IDOR cross-customer check', 'SKIP', 'No other customer shipment found');
    }

  } catch (error) {
    log('6', 'IDOR phase', 'FAIL', String(error));
  }
}

async function testErrorHandling() {
  console.log('\n=== Phase 8: Error Handling Tests ===\n');

  if (!context.customer) {
    log('8', 'Error handling tests', 'SKIP', 'No customer auth');
    return;
  }

  try {
    // Test 1: Non-existent shipment ID (validation or 404 both acceptable)
    const notFoundRes = await apiCall('/shipments/00000000-0000-0000-0000-000000000000', {
      token: context.customer.accessToken,
    });
    
    if (notFoundRes.status === 404 || notFoundRes.status === 403 || notFoundRes.status === 400) {
      log('8', 'Non-existent resource returns error', 'PASS', `status ${notFoundRes.status}`);
    } else {
      log('8', 'Non-existent resource returns error', 'FAIL', `status ${notFoundRes.status}`);
    }

    // Test 2: Missing required fields
    const missingFieldsRes = await apiCall('/shipments', {
      method: 'POST',
      token: context.customer.accessToken,
      body: {
        type: 'PACKAGE',
        // Missing required fields
      },
    });

    if (missingFieldsRes.status === 400) {
      log('8', 'Missing required fields validation', 'PASS');
    } else {
      log('8', 'Missing required fields validation', 'FAIL', `status ${missingFieldsRes.status}`);
    }

    // Test 3: Invalid enum value
    const invalidEnumRes = await apiCall('/shipments', {
      method: 'POST',
      token: context.customer.accessToken,
      body: {
        senderName: 'Test',
        senderPhone: '01712345678',
        senderAddress: 'Test Address',
        senderCity: 'Dhaka',
        originZoneId: 'cmtrd4f5a0011fmaokis67wvy',
        recipientName: 'Test',
        recipientPhone: '01787654321',
        recipientAddress: 'Test Address',
        recipientCity: 'Dhaka',
        destinationZoneId: 'cmupba8dr0006fm3kejd5864n',
        deliveryType: 'INVALID_TYPE', // Invalid enum
        declaredWeightKg: 2.5,
        items: [{ description: 'Test', weightKg: 2.5, quantity: 1 }],
      },
    });

    if (invalidEnumRes.status === 400) {
      log('8', 'Invalid enum value rejection', 'PASS');
    } else {
      log('8', 'Invalid enum value rejection', 'FAIL', `status ${invalidEnumRes.status}`);
    }

  } catch (error) {
    log('8', 'Error handling phase', 'FAIL', String(error));
  }
}

async function printSummary() {
  console.log('\n=== VERIFICATION SUMMARY ===\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const total = results.length;

  console.log(`Total: ${total} tests`);
  console.log(`✓ Passed: ${passed}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`○ Skipped: ${skipped}`);
  
  if (total - skipped > 0) {
    console.log(`\nSuccess Rate: ${((passed / (total - skipped)) * 100).toFixed(1)}%`);
  }

  if (failed > 0) {
    console.log('\n=== FAILURES ===\n');
    results
      .filter(r => r.status === 'FAIL')
      .forEach(r => {
        console.log(`✗ [${r.phase}] ${r.test}`);
        if (r.details) console.log(`  └─ ${r.details}`);
      });
  }
}

async function main() {
  console.log('=== LogiFlow API Verification Tests ===');
  console.log('Testing real HTTP → Backend → Prisma → PostgreSQL\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log('Database: PostgreSQL (development)\n');

  try {
    await authenticateUsers();
    await testShipmentCRUD();
    await testIDOR();
    await testErrorHandling();
    
    await printSummary();
  } catch (error) {
    console.error('\n=== FATAL ERROR ===');
    console.error(error);
    process.exit(1);
  }
}

main();
